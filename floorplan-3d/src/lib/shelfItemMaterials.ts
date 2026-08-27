import * as THREE from "three";

type FacePainter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

const cache = new Map<string, THREE.MeshStandardMaterial[]>();

/** Порядок материалов BoxGeometry: +X, −X, +Y, −Y, +Z, −Z */
export function shelfBoxMaterials(kind: "box" | "stack"): THREE.MeshStandardMaterial[] {
  const key = `${kind}:front+z`;
  const hit = cache.get(key);
  if (hit) return hit;

  const tape = kind === "stack" ? "#f07a1a" : "#6b4528";
  const card = kind === "stack" ? "#c9a56e" : "#c4a06a";
  const cardDark = kind === "stack" ? "#b08950" : "#9a7548";

  const front: FacePainter =
    kind === "stack"
      ? (ctx, w, h) => {
          fillCard(ctx, w, h, card, tape);
          roundRect(ctx, w * 0.1, h * 0.14, w * 0.42, h * 0.26, 5, "#f4f6f3");
        }
      : (ctx, w, h) => {
          fillCard(ctx, w, h, card, tape);
          roundRect(ctx, w * 0.1, h * 0.16, w * 0.38, h * 0.22, 5, "#f4f6f3");
          roundRect(ctx, w * 0.1, h * 0.44, w * 0.34, h * 0.2, 5, "#3fad45");
        };

  const side: FacePainter = (ctx, w, h) => fillCard(ctx, w, h, card, tape);
  const top: FacePainter = (ctx, w, h) => {
    ctx.fillStyle = card;
    ctx.fillRect(0, 0, w, h);
    const band = Math.max(6, h * 0.08);
    ctx.fillStyle = tape;
    ctx.fillRect(0, 0, w, band);
    ctx.fillRect(0, h - band, w, band);
    ctx.fillRect(w * 0.46, 0, w * 0.08, h);
    ctx.fillStyle = cardDark;
    ctx.fillRect(w * 0.492, band, w * 0.016, h - band * 2);
  };
  const bottom: FacePainter = (ctx, w, h) => {
    ctx.fillStyle = cardDark;
    ctx.fillRect(0, 0, w, h);
  };

  const back: FacePainter = (ctx, w, h) => {
    ctx.fillStyle = cardDark;
    ctx.fillRect(0, 0, w, h);
    const band = Math.max(6, h * 0.08);
    ctx.fillStyle = tape;
    ctx.fillRect(0, 0, w, band);
    ctx.fillRect(0, h - band, w, band);
  };

  // BoxGeometry: +X, −X, +Y, −Y, +Z (фронт к проходу), −Z (к задней стенке)
  const mats = [
    mat(paint(side)),
    mat(paint(side)),
    mat(paint(top)),
    mat(paint(bottom)),
    mat(paint(front)),
    mat(paint(back)),
  ];
  cache.set(key, mats);
  return mats;
}

export function cartonMaterials() {
  return shelfBoxMaterials("box");
}

const instanceMatCache = new Map<string, THREE.MeshStandardMaterial>();

/**
 * Одна текстура для InstancedMesh: картон как раньше (этикетки + скотч),
 * без 6 отдельных материалов на каждую коробку.
 */
export function shelfBoxInstanceMaterial(
  kind: "box" | "stack",
): THREE.MeshStandardMaterial {
  const key = `instance:${kind}`;
  const hit = instanceMatCache.get(key);
  if (hit) return hit;

  const tape = kind === "stack" ? "#f07a1a" : "#6b4528";
  const card = kind === "stack" ? "#c9a56e" : "#c4a06a";
  const cardDark = kind === "stack" ? "#b08950" : "#9a7548";

  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Не удалось нарисовать текстуру");
  fillCard(ctx, 256, 256, card, tape);
  if (kind === "stack") {
    roundRect(ctx, 256 * 0.1, 256 * 0.14, 256 * 0.42, 256 * 0.26, 5, "#f4f6f3");
  } else {
    roundRect(ctx, 256 * 0.1, 256 * 0.16, 256 * 0.38, 256 * 0.22, 5, "#f4f6f3");
    roundRect(ctx, 256 * 0.1, 256 * 0.44, 256 * 0.34, 256 * 0.2, 5, "#3fad45");
  }
  // Скотч сверху как у старой верхней грани
  const band = Math.max(6, 256 * 0.08);
  ctx.fillStyle = tape;
  ctx.fillRect(256 * 0.46, band, 256 * 0.08, 256 - band * 2);
  ctx.fillStyle = cardDark;
  ctx.fillRect(256 * 0.492, band, 256 * 0.016, 256 - band * 2);

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  map.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({
    map,
    roughness: 0.82,
    metalness: 0.02,
  });
  instanceMatCache.set(key, material);
  return material;
}

function paint(draw: FacePainter) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Не удалось нарисовать текстуру");
  draw(ctx, canvas.width, canvas.height);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  map.needsUpdate = true;
  return map;
}

function fillCard(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  card: string,
  tape: string,
) {
  ctx.fillStyle = card;
  ctx.fillRect(0, 0, w, h);
  const band = Math.max(8, h * 0.09);
  ctx.fillStyle = tape;
  ctx.fillRect(0, 0, w, band);
  ctx.fillRect(0, h - band, w, band);
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(0, band, w, h * 0.12);
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
    roughness: 0.82,
    metalness: 0.02,
  });
}
