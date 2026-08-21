import type { Opening } from "./process";

export const FLOOR_THICKNESS_M = 0.0004;
export const REAL_WALL_HEIGHT = 0.1;
export const PLATFORM_THICKNESS_M = 0.008;
export const PLATFORM_MARGIN_M = 0.04;

export function platformSize(planWidth: number, depth: number) {
  const margin = Math.max(PLATFORM_MARGIN_M, Math.max(planWidth, depth) * 0.08);
  return {
    width: planWidth + margin * 2,
    depth: depth + margin * 2,
    margin,
    thickness: PLATFORM_THICKNESS_M,
  };
}

export type BoxPart = {
  position: [number, number, number];
  rotationX?: number;
  rotationY: number;
  rotationZ?: number;
  size: [number, number, number];
  role: "lintel" | "sill" | "head" | "door" | "glass" | "rackUpright" | "rackBeam" | "rackDeck";
};

export function openingParts(
  opening: Opening,
  cell: number,
  wallHeight: number,
  yOffset = 0,
): BoxPart[] {
  const alongX = opening.axis === "x";
  const cx = (opening.c + opening.w / 2) * cell;
  const cz = (opening.r + opening.d / 2) * cell;
  const length = Math.max((alongX ? opening.w : opening.d) * cell, 0.004);
  const thick = Math.max((alongX ? opening.d : opening.w) * cell, 0.001);
  const rot = alongX ? 0 : Math.PI / 2;
  const fit = Math.min(0.0004, thick * 0.08);
  const doorH = clamp(wallHeight * 0.78, wallHeight * 0.45, wallHeight * 0.92);
  const sillH = clamp(
    opening.sillHeight ?? wallHeight * 0.32,
    wallHeight * 0.08,
    wallHeight * 0.55,
  );
  const headY = clamp(wallHeight * 0.82, sillH + wallHeight * 0.18, wallHeight * 0.92);

  if (opening.kind === "door") {
    const lintelH = Math.max(wallHeight * 0.08, wallHeight - doorH);
    const parts: BoxPart[] = [
      {
        position: [cx, yOffset + doorH + lintelH / 2, cz],
        rotationY: rot,
        size: [length + fit * 2, lintelH + fit, thick + fit],
        role: "lintel",
      },
    ];
    if (opening.hasLeaf !== false) {
      parts.push({
        position: [cx, yOffset + doorH / 2, cz],
        rotationY: rot,
        size: [length + fit * 2, doorH + fit, Math.max(0.001, thick * 0.7)],
        role: "door",
      });
    }
    return parts;
  }

  const headH = Math.max(wallHeight * 0.08, wallHeight - headY);
  const glassH = Math.max(wallHeight * 0.12, headY - sillH);
  return [
    {
      position: [cx, yOffset + sillH / 2, cz],
      rotationY: rot,
      size: [length + fit * 2, sillH + fit, thick + fit],
      role: "sill",
    },
    {
      position: [cx, yOffset + headY + headH / 2, cz],
      rotationY: rot,
      size: [length + fit * 2, headH + fit, thick + fit],
      role: "head",
    },
    {
      position: [cx, yOffset + sillH + glassH / 2, cz],
      rotationY: rot,
      size: [length + fit * 2, glassH + fit * 2, Math.max(0.0008, thick * 0.7)],
      role: "glass",
    },
  ];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function truncateParts(parts: BoxPart[], maxY: number): BoxPart[] {
  const out: BoxPart[] = [];
  for (const part of parts) {
    const y0 = part.position[1] - part.size[1] / 2;
    const y1 = part.position[1] + part.size[1] / 2;
    if (y1 <= 0.0002 || y0 >= maxY) continue;
    const ny0 = Math.max(y0, 0);
    const ny1 = Math.min(y1, maxY);
    const height = ny1 - ny0;
    if (height < 0.0004) continue;
    out.push({
      ...part,
      position: [part.position[0], (ny0 + ny1) / 2, part.position[2]],
      size: [part.size[0], height, part.size[2]],
    });
  }
  return out;
}
