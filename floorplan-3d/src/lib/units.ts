export const MM_PER_M = 1000;
export const PLAN_WIDTH_MM = 500;
export const SECTION_HEIGHT_MM = 100;

export function mmToM(mm: number) {
  return mm / MM_PER_M;
}

export function mToMm(meters: number) {
  return Math.round(meters * MM_PER_M);
}
