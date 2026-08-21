export type ProcessSettings = {
  sensitivity: number;
  blockSize: number;
  openRadius: number;
  closeRadius: number;
  minArea: number;
  invert: boolean;
  gridMax: number;
};

export const defaultSettings: ProcessSettings = {
  sensitivity: 12,
  blockSize: 35,
  openRadius: 1,
  closeRadius: 3,
  minArea: 80,
  invert: false,
  gridMax: 180,
};

export type Rect = {
  c: number;
  r: number;
  w: number;
  d: number;
};

export type RoomPatch = {
  id: number;
  rects: Rect[];
  area: number;
};

export type Opening = {
  id: string;
  c: number;
  r: number;
  w: number;
  d: number;
  kind: "door" | "window";
  axis: "x" | "z";
  sillHeight?: number;
  hasLeaf?: boolean;
};

export type FloorPlanModel = {
  wallRects: Rect[];
  rooms: RoomPatch[];
  openings: Opening[];
  solidGrid: Uint8Array;
  cols: number;
  rows: number;
  previewUrl: string;
  sourceUrl: string;
  wallCount: number;
};

const MAX_PROCESS = 900;

export function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Не удалось прочитать изображение"));
    };
    img.src = url;
  });
}

export function buildModel(
  image: HTMLImageElement,
  settings: ProcessSettings,
): FloorPlanModel {
  const { canvas, width, height } = drawToCanvas(image, MAX_PROCESS);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D недоступен");

  const pixels = ctx.getImageData(0, 0, width, height);
  const gray = toGray(pixels);
  const binary = adaptiveThreshold(
    gray,
    width,
    height,
    settings.blockSize,
    settings.sensitivity,
    settings.invert,
  );

  let mask = binary;
  if (settings.closeRadius > 0) {
    mask = dilate(mask, width, height, settings.closeRadius);
    mask = erode(mask, width, height, settings.closeRadius);
  }
  if (settings.openRadius > 0) {
    mask = erode(mask, width, height, settings.openRadius);
    mask = dilate(mask, width, height, settings.openRadius);
  }

  mask = dropSmallBlobs(mask, width, height, settings.minArea);
  mask = ensureWallsAreMinority(mask);
  mask = fillThinWallCavities(
    mask,
    width,
    height,
    Math.max(8, Math.min(36, Math.round(Math.min(width, height) * 0.03))),
  );

  const scale = settings.gridMax / Math.max(width, height);
  const gridCols = Math.max(8, Math.round(width * scale));
  const gridRows = Math.max(8, Math.round(height * scale));

  let walls = downsampleMax(mask, width, height, gridCols, gridRows);
  walls = fillThinWallCavities(
    walls,
    gridCols,
    gridRows,
    Math.max(2, Math.min(6, Math.round(Math.min(gridCols, gridRows) * 0.035))),
  );
  const wallRects = greedyRects(walls, gridCols, gridRows, 1);
  const openings = detectOpenings(walls, gridCols, gridRows);
  const filled = paintRects(walls, openings, gridCols, gridRows);
  const rooms = detectRooms(filled, walls, gridCols, gridRows);

  const previewUrl = maskToPreview(mask, width, height);
  const sourceUrl = canvas.toDataURL("image/png");

  return {
    wallRects,
    rooms,
    openings,
    solidGrid: filled,
    cols: gridCols,
    rows: gridRows,
    previewUrl,
    sourceUrl,
    wallCount: countOnes(walls),
  };
}

function drawToCanvas(image: HTMLImageElement, maxSize: number) {
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D недоступен");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);
  return { canvas, width, height };
}

function toGray(image: ImageData): Uint8Array {
  const { data, width, height } = image;
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const a = data[i + 3]!;
    if (a < 16) {
      gray[p] = 255;
      continue;
    }
    gray[p] = (data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114) | 0;
  }
  return gray;
}

function adaptiveThreshold(
  gray: Uint8Array,
  w: number,
  h: number,
  blockSize: number,
  c: number,
  invert: boolean,
): Uint8Array {
  const radius = Math.max(3, Math.floor(blockSize / 2));
  const integ = buildIntegral(gray, w, h);
  const out = new Uint8Array(w * h);
  const stride = w + 1;

  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(h, y + radius + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w, x + radius + 1);
      const sum =
        integ[y1 * stride + x1]! -
        integ[y0 * stride + x1]! -
        integ[y1 * stride + x0]! +
        integ[y0 * stride + x0]!;
      const count = (x1 - x0) * (y1 - y0);
      const mean = sum / count;
      const pixel = gray[y * w + x]!;
      const isDark = pixel < mean - c;
      out[y * w + x] = (invert ? !isDark : isDark) ? 1 : 0;
    }
  }
  return out;
}

function buildIntegral(gray: Uint8Array, w: number, h: number): Float64Array {
  const stride = w + 1;
  const integ = new Float64Array(stride * (h + 1));
  for (let y = 1; y <= h; y++) {
    let row = 0;
    for (let x = 1; x <= w; x++) {
      row += gray[(y - 1) * w + (x - 1)]!;
      integ[y * stride + x] = integ[(y - 1) * stride + x]! + row;
    }
  }
  return integ;
}

function erode(src: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  return morph(src, w, h, radius, true);
}

function dilate(src: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  return morph(src, w, h, radius, false);
}

function morph(
  src: Uint8Array,
  w: number,
  h: number,
  radius: number,
  erodeMode: boolean,
): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let keep = erodeMode;
      outer: for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) {
          if (erodeMode) {
            keep = false;
            break;
          }
          continue;
        }
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) {
            if (erodeMode) {
              keep = false;
              break outer;
            }
            continue;
          }
          const v = src[yy * w + xx]!;
          if (erodeMode && v === 0) {
            keep = false;
            break outer;
          }
          if (!erodeMode && v === 1) {
            keep = true;
            break outer;
          }
        }
      }
      out[y * w + x] = keep ? 1 : 0;
    }
  }
  return out;
}

function dropSmallBlobs(
  src: Uint8Array,
  w: number,
  h: number,
  minArea: number,
): Uint8Array {
  const out = src.slice();
  const seen = new Uint8Array(w * h);
  const qx = new Int32Array(w * h);
  const qy = new Int32Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const start = y * w + x;
      if (out[start] === 0 || seen[start]) continue;

      let head = 0;
      let tail = 0;
      qx[tail] = x;
      qy[tail] = y;
      tail++;
      seen[start] = 1;
      const cells: number[] = [];

      while (head < tail) {
        const cx = qx[head]!;
        const cy = qy[head]!;
        head++;
        const idx = cy * w + cx;
        cells.push(idx);
        for (const [dx, dy] of neighbors4) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nidx = ny * w + nx;
          if (seen[nidx] || out[nidx] === 0) continue;
          seen[nidx] = 1;
          qx[tail] = nx;
          qy[tail] = ny;
          tail++;
        }
      }

      if (cells.length < minArea) {
        for (const idx of cells) out[idx] = 0;
      }
    }
  }
  return out;
}

const neighbors4: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function ensureWallsAreMinority(mask: Uint8Array): Uint8Array {
  let ones = 0;
  for (let i = 0; i < mask.length; i++) ones += mask[i]!;
  if (ones > mask.length * 0.45) {
    const inverted = new Uint8Array(mask.length);
    for (let i = 0; i < mask.length; i++) inverted[i] = mask[i] ? 0 : 1;
    return inverted;
  }
  return mask;
}

function fillThinWallCavities(
  grid: Uint8Array,
  cols: number,
  rows: number,
  maxGap: number,
): Uint8Array {
  if (maxGap < 1) return grid;
  const out = grid.slice();
  fillShortRunsBetweenWalls(out, grid, cols, rows, maxGap, true);
  fillShortRunsBetweenWalls(out, grid, cols, rows, maxGap, false);
  return out;
}

function fillShortRunsBetweenWalls(
  out: Uint8Array,
  src: Uint8Array,
  cols: number,
  rows: number,
  maxGap: number,
  horizontal: boolean,
) {
  const primary = horizontal ? rows : cols;
  const secondary = horizontal ? cols : rows;
  for (let a = 0; a < primary; a++) {
    let b = 0;
    while (b < secondary) {
      const idx = horizontal ? a * cols + b : b * cols + a;
      if (src[idx]) {
        b++;
        continue;
      }
      const start = b;
      while (b < secondary) {
        const next = horizontal ? a * cols + b : b * cols + a;
        if (src[next]) break;
        b++;
      }
      const len = b - start;
      const leftIdx = horizontal ? a * cols + (start - 1) : (start - 1) * cols + a;
      const rightIdx = horizontal ? a * cols + b : b * cols + a;
      const wallLeft = start > 0 && src[leftIdx] === 1;
      const wallRight = b < secondary && src[rightIdx] === 1;
      if (!wallLeft || !wallRight || len > maxGap) continue;
      for (let i = start; i < b; i++) {
        out[horizontal ? a * cols + i : i * cols + a] = 1;
      }
    }
  }
}

function downsampleMax(
  src: Uint8Array,
  w: number,
  h: number,
  cols: number,
  rows: number,
): Uint8Array {
  const out = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    const y0 = Math.floor((r * h) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((r + 1) * h) / rows));
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor((c * w) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((c + 1) * w) / cols));
      let wall = 0;
      for (let y = y0; y < y1 && !wall; y++) {
        for (let x = x0; x < x1; x++) {
          if (src[y * w + x]) {
            wall = 1;
            break;
          }
        }
      }
      out[r * cols + c] = wall;
    }
  }
  return out;
}

export function greedyRects(
  grid: Uint8Array,
  cols: number,
  rows: number,
  value: number,
): Rect[] {
  const seen = new Uint8Array(cols * rows);
  const rects: Rect[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const start = r * cols + c;
      if (grid[start] !== value || seen[start]) continue;

      let w = 1;
      while (
        c + w < cols &&
        grid[r * cols + c + w] === value &&
        !seen[r * cols + c + w]
      ) {
        w++;
      }

      let d = 1;
      expand: while (r + d < rows) {
        for (let x = 0; x < w; x++) {
          const idx = (r + d) * cols + c + x;
          if (grid[idx] !== value || seen[idx]) break expand;
        }
        d++;
      }

      for (let y = 0; y < d; y++) {
        for (let x = 0; x < w; x++) {
          seen[(r + y) * cols + c + x] = 1;
        }
      }
      rects.push({ c, r, w, d });
    }
  }
  return rects;
}

function paintRects(
  grid: Uint8Array,
  rects: Array<{ c: number; r: number; w: number; d: number }>,
  cols: number,
  rows: number,
): Uint8Array {
  const out = grid.slice();
  for (const o of rects) {
    for (let r = o.r; r < o.r + o.d; r++) {
      for (let c = o.c; c < o.c + o.w; c++) {
        if (r >= 0 && c >= 0 && r < rows && c < cols) out[r * cols + c] = 1;
      }
    }
  }
  return out;
}

type GapRun = { a: number; b0: number; b1: number };

type OpeningRect = {
  c: number;
  r: number;
  w: number;
  d: number;
  axis: "x" | "z";
};

function expandToJambs(
  rect: OpeningRect,
  walls: Uint8Array,
  cols: number,
  rows: number,
): OpeningRect {
  if (rect.axis === "x") {
    let c0 = rect.c;
    let c1 = rect.c + rect.w;
    const r0 = Math.max(0, rect.r);
    const r1 = Math.min(rows, rect.r + rect.d);
    for (let r = r0; r < r1; r++) {
      let a = rect.c;
      let b = rect.c + rect.w;
      while (a > 0 && !walls[r * cols + (a - 1)]) a--;
      while (b < cols && !walls[r * cols + b]) b++;
      c0 = Math.min(c0, a);
      c1 = Math.max(c1, b);
    }
    return { ...rect, c: c0, w: Math.max(1, c1 - c0) };
  }
  let r0 = rect.r;
  let r1 = rect.r + rect.d;
  const c0 = Math.max(0, rect.c);
  const c1 = Math.min(cols, rect.c + rect.w);
  for (let c = c0; c < c1; c++) {
    let a = rect.r;
    let b = rect.r + rect.d;
    while (a > 0 && !walls[(a - 1) * cols + c]) a--;
    while (b < rows && !walls[b * cols + c]) b++;
    r0 = Math.min(r0, a);
    r1 = Math.max(r1, b);
  }
  return { ...rect, r: r0, d: Math.max(1, r1 - r0) };
}

function detectOpenings(walls: Uint8Array, cols: number, rows: number): Opening[] {
  const minLen = Math.max(4, Math.round(Math.min(cols, rows) * 0.03));
  const maxLen = Math.max(14, Math.round(Math.min(cols, rows) * 0.24));
  const maxThick = Math.max(3, Math.round(Math.min(cols, rows) * 0.04));

  const horizontal = mergeGapRuns(
    collectGapRuns(walls, cols, rows, true, minLen, maxLen),
    "x",
    minLen,
    maxThick,
  );
  const vertical = mergeGapRuns(
    collectGapRuns(walls, cols, rows, false, minLen, maxLen),
    "z",
    minLen,
    maxThick,
  );

  const rects = dedupeOpenings(
    [...horizontal, ...vertical]
      .filter((rect) => isThroughGap(rect, walls, cols, rows))
      .map((rect) => expandToJambs(rect, walls, cols, rows)),
  );

  const filled = paintRects(walls, rects, cols, rows);
  const empty = new Uint8Array(filled.length);
  for (let i = 0; i < filled.length; i++) empty[i] = filled[i] ? 0 : 1;
  const exterior = floodFromBorder(empty, cols, rows);
  const doorMax = Math.max(8, Math.round(Math.min(cols, rows) * 0.095));

  return rects.map((rect) => {
    const length = rect.axis === "x" ? rect.w : rect.d;
    const outside = touchesExterior(rect, exterior, cols, rows);
    const kind: Opening["kind"] = !outside || length <= doorMax ? "door" : "window";
    return {
      ...rect,
      kind,
      id: `${kind}-${rect.axis}-${rect.c}-${rect.r}-${rect.w}-${rect.d}`,
    };
  });
}

function collectGapRuns(
  walls: Uint8Array,
  cols: number,
  rows: number,
  horizontal: boolean,
  minLen: number,
  maxLen: number,
): GapRun[] {
  const runs: GapRun[] = [];
  const primary = horizontal ? rows : cols;
  const secondary = horizontal ? cols : rows;

  for (let a = 0; a < primary; a++) {
    let b = 0;
    while (b < secondary) {
      const idx = horizontal ? a * cols + b : b * cols + a;
      if (walls[idx]) {
        b++;
        continue;
      }
      const start = b;
      while (b < secondary) {
        const next = horizontal ? a * cols + b : b * cols + a;
        if (walls[next]) break;
        b++;
      }
      const len = b - start;
      const leftIdx = horizontal ? a * cols + (start - 1) : (start - 1) * cols + a;
      const rightIdx = horizontal ? a * cols + b : b * cols + a;
      const hasLeft = start > 0 && walls[leftIdx] === 1;
      const hasRight = b < secondary && walls[rightIdx] === 1;
      if (hasLeft && hasRight && len >= minLen && len <= maxLen) {
        runs.push({ a, b0: start, b1: b });
      }
    }
  }
  return runs;
}

function mergeGapRuns(
  runs: GapRun[],
  axis: "x" | "z",
  minLen: number,
  maxThick: number,
): OpeningRect[] {
  const sorted = [...runs].sort((p, q) => p.a - q.a || p.b0 - q.b0);
  const used = new Uint8Array(sorted.length);
  const rects: OpeningRect[] = [];

  for (let i = 0; i < sorted.length; i++) {
    if (used[i]) continue;
    let a0 = sorted[i]!.a;
    let a1 = sorted[i]!.a;
    let b0 = sorted[i]!.b0;
    let b1 = sorted[i]!.b1;
    used[i] = 1;
    let grew = true;
    while (grew) {
      grew = false;
      for (let j = 0; j < sorted.length; j++) {
        if (used[j]) continue;
        const run = sorted[j]!;
        if (run.a !== a1 + 1) continue;
        const overlap = Math.min(b1, run.b1) - Math.max(b0, run.b0);
        const span = Math.min(b1 - b0, run.b1 - run.b0);
        if (overlap < span * 0.65) continue;
        if (overlap < minLen) continue;
        used[j] = 1;
        b0 = Math.min(b0, run.b0);
        b1 = Math.max(b1, run.b1);
        a1 = run.a;
        grew = true;
      }
    }

    const thick = a1 - a0 + 1;
    const len = b1 - b0;
    if (thick > maxThick || len < minLen || len / thick < 2.1) continue;
    if (axis === "x") rects.push({ c: b0, r: a0, w: len, d: thick, axis: "x" });
    else rects.push({ c: a0, r: b0, w: thick, d: len, axis: "z" });
  }
  return rects;
}

function isThroughGap(
  rect: OpeningRect,
  walls: Uint8Array,
  cols: number,
  rows: number,
): boolean {
  if (rect.axis === "x") {
    return (
      lineMostlyEmpty(walls, cols, rows, rect.c, rect.c + rect.w, rect.r - 1, rect.r) &&
      lineMostlyEmpty(walls, cols, rows, rect.c, rect.c + rect.w, rect.r + rect.d, rect.r + rect.d + 1)
    );
  }
  return (
    lineMostlyEmpty(walls, cols, rows, rect.c - 1, rect.c, rect.r, rect.r + rect.d) &&
    lineMostlyEmpty(walls, cols, rows, rect.c + rect.w, rect.c + rect.w + 1, rect.r, rect.r + rect.d)
  );
}

function lineMostlyEmpty(
  walls: Uint8Array,
  cols: number,
  rows: number,
  c0: number,
  c1: number,
  r0: number,
  r1: number,
): boolean {
  let empty = 0;
  let total = 0;
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      total++;
      if (r < 0 || c < 0 || r >= rows || c >= cols || !walls[r * cols + c]) empty++;
    }
  }
  return total === 0 || empty / total >= 0.65;
}

function dedupeOpenings(rects: OpeningRect[]): OpeningRect[] {
  const keep = rects.map(() => true);
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (!keep[i] || !keep[j]) continue;
      const a = rects[i]!;
      const b = rects[j]!;
      const overlap = overlapArea(a, b);
      if (overlap <= 0.45 * Math.min(a.w * a.d, b.w * b.d)) continue;
      const aspectA = (a.axis === "x" ? a.w / a.d : a.d / a.w);
      const aspectB = (b.axis === "x" ? b.w / b.d : b.d / b.w);
      if (aspectA >= aspectB) keep[j] = false;
      else keep[i] = false;
    }
  }
  return rects.filter((_, i) => keep[i]);
}

function overlapArea(
  a: { c: number; r: number; w: number; d: number },
  b: { c: number; r: number; w: number; d: number },
): number {
  const x0 = Math.max(a.c, b.c);
  const y0 = Math.max(a.r, b.r);
  const x1 = Math.min(a.c + a.w, b.c + b.w);
  const y1 = Math.min(a.r + a.d, b.r + b.d);
  return Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
}

function touchesExterior(
  rect: OpeningRect,
  exterior: Uint8Array,
  cols: number,
  rows: number,
): boolean {
  const hit = (c: number, r: number) => {
    if (c < 0 || r < 0 || c >= cols || r >= rows) return true;
    return exterior[r * cols + c] === 1;
  };
  if (rect.axis === "x") {
    for (let c = rect.c; c < rect.c + rect.w; c++) {
      if (hit(c, rect.r - 1) || hit(c, rect.r + rect.d)) return true;
    }
  } else {
    for (let r = rect.r; r < rect.r + rect.d; r++) {
      if (hit(rect.c - 1, r) || hit(rect.c + rect.w, r)) return true;
    }
  }
  return false;
}

function closeBinary(src: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  if (radius <= 0) return src;
  return erode(dilate(src, w, h, radius), w, h, radius);
}

function detectRooms(
  filled: Uint8Array,
  originalWalls: Uint8Array,
  cols: number,
  rows: number,
): RoomPatch[] {
  const sealed = closeBinary(filled, cols, rows, 2);
  const empty = new Uint8Array(cols * rows);
  for (let i = 0; i < sealed.length; i++) empty[i] = sealed[i] ? 0 : 1;

  const exterior = floodFromBorder(empty, cols, rows);
  const interior = new Uint8Array(cols * rows);
  for (let i = 0; i < empty.length; i++) {
    interior[i] = empty[i] && !exterior[i] ? 1 : 0;
  }

  const seen = new Uint8Array(cols * rows);
  const rooms: RoomPatch[] = [];
  let roomId = 0;
  const minRoom = Math.max(18, Math.floor((cols * rows) * 0.004));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const start = r * cols + c;
      if (!interior[start] || seen[start]) continue;

      const blob = new Uint8Array(cols * rows);
      const stack = [start];
      seen[start] = 1;
      let area = 0;
      while (stack.length) {
        const idx = stack.pop()!;
        blob[idx] = 1;
        area++;
        const x = idx % cols;
        const y = (idx / cols) | 0;
        for (const [dx, dy] of neighbors4) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const nidx = ny * cols + nx;
          if (seen[nidx] || !interior[nidx]) continue;
          seen[nidx] = 1;
          stack.push(nidx);
        }
      }

      if (area < minRoom) continue;
      for (let i = 0; i < blob.length; i++) {
        if (originalWalls[i]) blob[i] = 0;
      }
      rooms.push({
        id: roomId++,
        rects: greedyRects(blob, cols, rows, 1),
        area,
      });
    }
  }

  rooms.sort((a, b) => b.area - a.area);
  return rooms;
}

function floodFromBorder(empty: Uint8Array, cols: number, rows: number): Uint8Array {
  const seen = new Uint8Array(cols * rows);
  const stack: number[] = [];

  const push = (c: number, r: number) => {
    const idx = r * cols + c;
    if (empty[idx] && !seen[idx]) {
      seen[idx] = 1;
      stack.push(idx);
    }
  };

  for (let c = 0; c < cols; c++) {
    push(c, 0);
    push(c, rows - 1);
  }
  for (let r = 0; r < rows; r++) {
    push(0, r);
    push(cols - 1, r);
  }

  while (stack.length) {
    const idx = stack.pop()!;
    const x = idx % cols;
    const y = (idx / cols) | 0;
    for (const [dx, dy] of neighbors4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const nidx = ny * cols + nx;
      if (seen[nidx] || !empty[nidx]) continue;
      seen[nidx] = 1;
      stack.push(nidx);
    }
  }
  return seen;
}

function maskToPreview(mask: Uint8Array, w: number, h: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const img = ctx.createImageData(w, h);
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    if (mask[i]) {
      img.data[p] = 196;
      img.data[p + 1] = 165;
      img.data[p + 2] = 116;
      img.data[p + 3] = 255;
    } else {
      img.data[p] = 18;
      img.data[p + 1] = 22;
      img.data[p + 2] = 20;
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

function countOnes(grid: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < grid.length; i++) n += grid[i]!;
  return n;
}
