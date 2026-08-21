export function createSamplePlan(): Promise<HTMLImageElement> {
  const w = 1100;
  const h = 800;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Canvas 2D недоступен"));

  ctx.fillStyle = "#f7f4ee";
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "#d8d0c4";
  ctx.lineWidth = 1;
  for (let x = 40; x < w; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 40; y < h; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  const T = 16;
  const t = 10;
  ctx.fillStyle = "#1a1a1a";

  const hWall = (
    x: number,
    y: number,
    length: number,
    thickness: number,
    openings: Array<{ offset: number; width: number }> = [],
  ) => {
    const segments = subtractDoors(length, openings);
    for (const s of segments) {
      ctx.fillRect(x + s.start, y - thickness / 2, s.len, thickness);
    }
  };

  const vWall = (
    x: number,
    y: number,
    length: number,
    thickness: number,
    openings: Array<{ offset: number; width: number }> = [],
  ) => {
    const segments = subtractDoors(length, openings);
    for (const s of segments) {
      ctx.fillRect(x - thickness / 2, y + s.start, thickness, s.len);
    }
  };

  const x0 = 70;
  const y0 = 70;
  const x1 = 1030;
  const y1 = 730;
  const outerW = x1 - x0;
  const outerH = y1 - y0;

  hWall(x0, y0, outerW, T, [
    { offset: 90, width: 140 },
    { offset: 290, width: 130 },
    { offset: 540, width: 150 },
    { offset: 760, width: 140 },
  ]);
  hWall(x0, y1, outerW, T, [{ offset: 210, width: 68 }]);
  vWall(x0, y0, outerH, T, [{ offset: 100, width: 130 }]);
  vWall(x1, y0, outerH, T, [
    { offset: 80, width: 130 },
    { offset: 340, width: 130 },
  ]);

  const splitX = 560;
  vWall(splitX, y0, outerH, t, [
    { offset: 250, width: 62 },
    { offset: 470, width: 62 },
  ]);

  hWall(x0, 430, splitX - x0, t, [{ offset: 180, width: 62 }]);
  vWall(300, 430, y1 - 430, t, [{ offset: 90, width: 56 }]);

  hWall(splitX, 360, x1 - splitX, t, [{ offset: 90, width: 60 }]);
  vWall(820, 360, y1 - 360, t, [{ offset: 90, width: 56 }]);
  hWall(820, 560, x1 - 820, t, [{ offset: 70, width: 56 }]);

  return canvasToImage(canvas);
}

function subtractDoors(
  length: number,
  doors: Array<{ offset: number; width: number }>,
): Array<{ start: number; len: number }> {
  const sorted = [...doors].sort((a, b) => a.offset - b.offset);
  const parts: Array<{ start: number; len: number }> = [];
  let cursor = 0;
  for (const door of sorted) {
    const start = Math.max(0, door.offset);
    const end = Math.min(length, door.offset + door.width);
    if (start > cursor) parts.push({ start: cursor, len: start - cursor });
    cursor = Math.max(cursor, end);
  }
  if (cursor < length) parts.push({ start: cursor, len: length - cursor });
  return parts;
}

function canvasToImage(canvas: HTMLCanvasElement): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Не удалось создать пример плана"));
    img.src = canvas.toDataURL("image/png");
  });
}
