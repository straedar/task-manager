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
const REAL_LEVELS_MM = [465, 922, 1362, 1802, 2242];

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
  const levelsN = Math.max(1, Math.min(8, Math.round(shelfCount) || 5));
  const height = clamp(heightM, 1.2, 6);
  const scale = height / mmToM(REAL_HEIGHT_MM);
  const post = clamp(mmToM(REAL_POST_MM) * scale, 0.03, 0.07);
  const beamH = clamp(mmToM(REAL_BEAM_MM) * scale, 0.025, 0.055);
  const deckT = clamp(mmToM(REAL_DECK_MM) * scale, 0.012, 0.03);
  const hx = along / 2 - post / 2;
  const hz = deep / 2 - post / 2;
  const innerW = Math.max(along - post * 2, along * 0.55);
  const innerD = Math.max(deep - post * 2, deep * 0.5);

  const sourceLevels = REAL_LEVELS_MM.slice(0, levelsN);
  const levels: RackLevel[] = sourceLevels.map((levelMm, index) => {
    const beamY = clamp((levelMm / REAL_HEIGHT_MM) * height, beamH / 2, height - beamH / 2);
    const deckTop = beamY + beamH / 2 + deckT;
    const next = sourceLevels[index + 1];
    const ceiling = next
      ? clamp((next / REAL_HEIGHT_MM) * height, beamH / 2, height - beamH / 2) - beamH / 2
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
    // Задняя балка (закрытая сторона) и настил; перед (+hz) открыт для доступа
    parts.push({
      position: [0, level.beamY, -hz],
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
  // Кресты только на торцах (±X), не на открытой стороне
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
  const spanZ = Math.max(frame.innerD - size.d, 0);
  const a = Math.min(1, Math.max(0, along));
  const d = Math.min(1, Math.max(0, depth));
  return {
    position: [
      -frame.innerW / 2 + size.w / 2 + a * spanX,
      level.deckTop + size.h / 2,
      -frame.innerD / 2 + size.d / 2 + d * spanZ,
    ] as [number, number, number],
    size: [size.w, size.h, size.d] as [number, number, number],
  };
}
