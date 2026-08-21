import * as THREE from "three";

const CARD = "#c4a06a";
const CARD_DARK = "#9a7548";
const SEAM = "#7d5c38";

let cached: THREE.MeshStandardMaterial[] | null = null;

export function cartonMaterials() {
  if (cached) return cached;

  const front = paint((ctx, w, h) => {
    fillCard(ctx, w, h);
    roundRect(ctx, w * 0.12, h * 0.12, w * 0.42, h * 0.28, 4, "#f4f6f3");
    roundRect(ctx, w * 0.12, h * 0.48, w * 0.36, h * 0.22, 4, "#3fad45");
  });
  const side = paint((ctx, w, h) => fillCard(ctx, w, h));
  const top = paint((ctx, w, h) => {
    fillCard(ctx, w, h);
    ctx.fillStyle = CARD_DARK;
    ctx.fillRect(w * 0.46, 0, w * 0.08, h);
    ctx.fillStyle = SEAM;
    ctx.fillRect(w * 0.492, 0, w * 0.016, h);
  });
  const bottom = paint((ctx, w, h) => fillCard(ctx, w, h));
  const back = paint((ctx, w, h) => fillCard(ctx, w, h));

  cached = [
    mat(side),
    mat(side),
    mat(top),
    mat(bottom),
    mat(front),
    mat(back),
  ];
  return cached;
}

function paint(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Не удалось нарисовать текстуру коробки");
  draw(ctx, canvas.width, canvas.height);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  map.needsUpdate = true;
  return map;
}

function fillCard(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = CARD;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.fillRect(0, 0, w, h * 0.18);
  ctx.strokeStyle = "rgba(80, 50, 24, 0.18)";
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, w - 8, h - 8);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function mat(map: THREE.CanvasTexture) {
  return new THREE.MeshStandardMaterial({
    map,
    roughness: 0.78,
    metalness: 0.02,
  });
}
