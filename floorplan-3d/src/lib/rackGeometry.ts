/** Rack frame geometry adapted from the old floorplan-3d shelf model. */

export type RackPart = {
  position: [number, number, number];
  rotationX?: number;
  size: [number, number, number];
  role: "rackUpright" | "rackBeam" | "rackDeck";
};

export type RackLevel = {
  index: number;
  beamY: number;
  deckTop: number;
  clearH: number;
};

export type RackFrame = {
  along: number;
  deep: number;
  height: number;
  post: number;
  beamH: number;
  deckT: number;
  /** Запас сзади (0 — без задней стенки). */
  backT: number;
  innerW: number;
  innerD: number;
  hx: number;
  hz: number;
  levels: RackLevel[];
};

const REAL_HEIGHT_MM = 2700;
const REAL_POST_MM = 55;
const REAL_BEAM_MM = 50;
const REAL_DECK_MM = 12;
const REAL_BRACE_MM = 30;

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function mmToM(mm: number) {
  return mm / 1000;
}

export function buildRackFrame(
  alongM: number,
  deepM: number,
  shelfCount: number,
  heightM = 2.7,
): RackFrame {
  const along = Math.max(alongM, 0.4);
  const deep = Math.max(deepM, 0.3);
  const levelsN = Math.max(1, Math.min(40, Math.round(shelfCount) || 5));
  const height = clamp(heightM, 1.2, 12);
  const scale = height / mmToM(REAL_HEIGHT_MM);
  const post = clamp(mmToM(REAL_POST_MM) * scale, 0.03, 0.07);
  const beamH = clamp(mmToM(REAL_BEAM_MM) * scale, 0.025, 0.055);
  const deckT = clamp(mmToM(REAL_DECK_MM) * scale, 0.012, 0.03);
  const hx = along / 2 - post / 2;
  const hz = deep / 2 - post / 2;
  const backT = 0;
  const innerW = Math.max(along - post * 2, along * 0.55);
  const innerD = Math.max(deep - post * 2, deep * 0.5);

  // Равномерно по высоте, чтобы 1–8 полок визуально отличались в 3Д
  const margin = height * 0.08;
  const usable = Math.max(beamH * 2, height - margin * 2);
  const sourceLevels: number[] = [];
  for (let i = 0; i < levelsN; i++) {
    const t = levelsN === 1 ? 0.5 : i / (levelsN - 1);
    sourceLevels.push(margin + usable * t);
  }
  const levels: RackLevel[] = sourceLevels.map((beamYRaw, index) => {
    const beamY = clamp(beamYRaw, beamH / 2, height - beamH / 2);
    const deckTop = beamY + beamH / 2 + deckT;
    const next = sourceLevels[index + 1];
    const ceiling = next != null
      ? clamp(next, beamH / 2, height - beamH / 2) - beamH / 2
      : height;
    return {
      index,
      beamY,
      deckTop,
      clearH: Math.max(0.05, ceiling - deckTop),
    };
  });

  return {
    along,
    deep,
    height,
    post,
    beamH,
    deckT,
    backT,
    innerW,
    innerD,
    hx,
    hz,
    levels,
  };
}

export function buildRackParts(frame: RackFrame): RackPart[] {
  const { hx, hz, height, post, innerW, innerD, beamH, deckT } = frame;
  const beamD = clamp(post * 0.72, 0.02, 0.05);
  const braceT = clamp(mmToM(REAL_BRACE_MM) * (height / mmToM(REAL_HEIGHT_MM)), 0.02, 0.04);
  const parts: RackPart[] = [
    { position: [-hx, height / 2, -hz], size: [post, height, post], role: "rackUpright" },
    { position: [hx, height / 2, -hz], size: [post, height, post], role: "rackUpright" },
    { position: [-hx, height / 2, hz], size: [post, height, post], role: "rackUpright" },
    { position: [hx, height / 2, hz], size: [post, height, post], role: "rackUpright" },
  ];

  for (const level of frame.levels) {
    // Балки спереди и сзади; настил между ними
    parts.push({
      position: [0, level.beamY, -hz],
      size: [innerW, beamH, beamD],
      role: "rackBeam",
    });
    parts.push({
      position: [0, level.beamY, hz],
      size: [innerW, beamH, beamD],
      role: "rackBeam",
    });
    parts.push({
      position: [0, level.beamY + beamH / 2 + deckT / 2, 0],
      size: [innerW, deckT, innerD],
      role: "rackDeck",
    });
  }

  const yBot = beamH * 0.6;
  const yTop = height - beamH * 0.6;
  // Кресты только на торцах (±X), не на открытой стороне (+Z)
  for (const x of [-hx, hx]) {
    parts.push(diagonalYZ(x, yBot, -hz, yTop, hz, braceT));
    parts.push(diagonalYZ(x, yBot, hz, yTop, -hz, braceT));
    parts.push({
      position: [x, height / 2, 0],
      size: [braceT, braceT, innerD],
      role: "rackUpright",
    });
  }

  return parts;
}

function diagonalYZ(
  x: number,
  y0: number,
  z0: number,
  y1: number,
  z1: number,
  thick: number,
): RackPart {
  const dy = y1 - y0;
  const dz = z1 - z0;
  const len = Math.max(Math.hypot(dy, dz), thick);
  return {
    position: [x, (y0 + y1) / 2, (z0 + z1) / 2],
    rotationX: Math.atan2(dz, dy),
    size: [thick, len, thick],
    role: "rackUpright",
  };
}

export function truncateRackParts(parts: RackPart[], maxY: number): RackPart[] {
  const out: RackPart[] = [];
  for (const part of parts) {
    const y0 = part.position[1] - part.size[1] / 2;
    const y1 = part.position[1] + part.size[1] / 2;
    if (y0 >= maxY) continue;
    if (y1 <= maxY) {
      out.push(part);
      continue;
    }
    const newH = Math.max(0.001, maxY - y0);
    out.push({
      ...part,
      position: [part.position[0], y0 + newH / 2, part.position[2]],
      size: [part.size[0], newH, part.size[2]],
    });
  }
  return out;
}

export function cartonPoseOnLevel(
  frame: RackFrame,
  levelIndex: number,
  along: number,
  depth: number,
) {
  const level = frame.levels[levelIndex];
  if (!level) return null;
  const scale = frame.height / mmToM(REAL_HEIGHT_MM);
  const size = {
    w: Math.min(0.38 * scale, frame.innerW * 0.42),
    d: Math.min(0.28 * scale, frame.innerD * 0.72),
    h: Math.min(0.25 * scale, level.clearH * 0.88),
  };
  const spanX = Math.max(frame.innerW - size.w, 0);
  const usableD = Math.max(frame.innerD - frame.backT, frame.innerD * 0.55);
  const spanZ = Math.max(usableD - size.d, 0);
  const a = Math.min(1, Math.max(0, along));
  const d = Math.min(1, Math.max(0, depth));
  const z0 = -frame.innerD / 2 + frame.backT;
  return {
    position: [
      -frame.innerW / 2 + size.w / 2 + a * spanX,
      level.deckTop + size.h / 2,
      z0 + size.d / 2 + d * spanZ,
    ] as [number, number, number],
    size: [size.w, size.h, size.d] as [number, number, number],
  };
}

export type ShelfItemLayoutInput = {
  id: number;
  type: "box" | "container" | "cell" | "stack";
  widthRatio: number;
  posX: number;
  shelfIndex: number;
  depthRow: number;
  stackOrder: number;
};

export type ShelfItemPose = {
  itemId: number;
  type: ShelfItemLayoutInput["type"];
  position: [number, number, number];
  size: [number, number, number];
};

/** Как в меню стеллажа: коробка ≈ высота полки × widthRatio. */
const INTERIOR_SHELF_H_PX = 147;
const INTERIOR_STACK_MIN_PX = 56;
const INTERIOR_BOX_MIN_PX = 24;

function interiorHeightFactor(type: ShelfItemLayoutInput["type"]) {
  return type === "stack" ? 0.55 : 0.99;
}

function interiorPixelWidth(
  type: ShelfItemLayoutInput["type"],
  widthRatio: number,
) {
  const wr = Math.max(0.05, widthRatio || 1);
  return Math.max(
    type === "stack" ? INTERIOR_STACK_MIN_PX : INTERIOR_BOX_MIN_PX,
    INTERIOR_SHELF_H_PX * interiorHeightFactor(type) * wr,
  );
}

function levelForShelfIndex(frame: RackFrame, shelfIndex: number): RackLevel | null {
  const idx = Math.max(0, (shelfIndex || 1) - 1);
  if (frame.levels[idx]) return frame.levels[idx]!;
  const last = frame.levels[frame.levels.length - 1];
  if (!last) return null;
  const clearH = last.clearH;
  return {
    index: idx,
    beamY: frame.height - frame.beamH / 2,
    deckTop: frame.height,
    clearH,
  };
}

/** Раскладка как в меню: коробка ≈ квадрат на высоту проёма, глубина на всю полку. */
export function layoutShelfItemsOnRack(
  frame: RackFrame,
  items: ShelfItemLayoutInput[],
  _frameWidthPx?: number | null,
): ShelfItemPose[] {
  const out: ShelfItemPose[] = [];
  const byShelf = new Map<string, ShelfItemLayoutInput[]>();
  for (const item of items) {
    const key = `${item.shelfIndex}:${item.depthRow}`;
    const list = byShelf.get(key);
    if (list) list.push(item);
    else byShelf.set(key, [item]);
  }

  const maxRow = Math.max(1, ...items.map((i) => i.depthRow || 1));
  const usableD = Math.max(frame.innerD - frame.backT, frame.innerD * 0.55);
  const z0 = -frame.innerD / 2 + frame.backT;

  for (const group of byShelf.values()) {
    group.sort(
      (a, b) =>
        a.posX - b.posX || a.stackOrder - b.stackOrder || a.id - b.id,
    );
    const level = levelForShelfIndex(frame, group[0]?.shelfIndex ?? 1);
    if (!level) continue;
    const depthRow = group[0]?.depthRow ?? 1;
    const bayH = Math.max(0.08, level.clearH);

    const columns: ShelfItemLayoutInput[][] = [];
    for (const item of group) {
      const prev = columns[columns.length - 1];
      if (prev && prev[0] && prev[0].posX === item.posX) prev.push(item);
      else columns.push([item]);
    }

    const pxToM = bayH / INTERIOR_SHELF_H_PX;
    const raw = columns.map((col) => {
      const colPx = Math.max(
        ...col.map((item) => interiorPixelWidth(item.type, item.widthRatio)),
      );
      return {
        col,
        w: colPx * pxToM,
        xLeft: col[0]!.posX * pxToM,
      };
    });
    let maxRight = 0;
    for (const entry of raw) {
      maxRight = Math.max(maxRight, entry.xLeft + entry.w);
    }
    const fit = maxRight > frame.innerW ? frame.innerW / maxRight : 1;

    const rowSpan = usableD / maxRow;
    const d = Math.max(0.05, rowSpan * 0.92);
    // Ряд 1 = фронт (+Z), больший ряд — глубже к задней стенке
    const z = z0 + (maxRow - depthRow + 0.5) * rowSpan;

    for (const entry of raw) {
      const stackN = Math.max(1, entry.col.length);
      const w = Math.max(0.05, entry.w * fit);
      const x =
        -frame.innerW / 2 + entry.xLeft * fit + w / 2;
      const pileH = Math.max(0.05, bayH * 0.92);
      const gap = 0.006;
      const slotH = Math.max(0.04, (pileH - gap * (stackN - 1)) / stackN);

      for (const item of entry.col) {
        const factor = interiorHeightFactor(item.type);
        const itemH = clamp(slotH * (factor / 0.99), 0.04, slotH);
        out.push({
          itemId: item.id,
          type: item.type,
          position: [
            x,
            level.deckTop + itemH / 2 + item.stackOrder * (slotH + gap),
            z,
          ],
          size: [w, itemH, d],
        });
      }
    }
  }
  return out;
}
