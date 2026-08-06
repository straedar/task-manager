/** Canvas helpers for react-easy-crop export. */

export type Area = { x: number; y: number; width: number; height: number };

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(new Error("Не удалось прочитать изображение")));
    image.src = url;
  });
}

function canvasHasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const { data } = ctx.getImageData(0, 0, w, h);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i]! < 255) return true;
  }
  return false;
}

async function blobFromCanvas(
  canvas: HTMLCanvasElement,
  type: "image/png" | "image/jpeg" | "image/webp",
  quality?: number
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

/**
 * Export cropped region. Prefers PNG (keeps transparency); falls back to WebP/JPEG if over maxBytes.
 */
export async function getCroppedImage(opts: {
  imageSrc: string;
  pixelCrop: Area;
  outputSize?: number;
  maxSide?: number;
  maxBytes: number;
  fileName?: string;
  /** Prefer PNG (avatar). Default true. */
  preferPng?: boolean;
}): Promise<File> {
  const image = await createImage(opts.imageSrc);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) throw new Error("Canvas недоступен");

  let outW: number;
  let outH: number;
  if (opts.outputSize != null) {
    outW = opts.outputSize;
    outH = opts.outputSize;
  } else {
    const maxSide = opts.maxSide ?? 1280;
    const scale = Math.min(1, maxSide / Math.max(opts.pixelCrop.width, opts.pixelCrop.height));
    outW = Math.max(1, Math.round(opts.pixelCrop.width * scale));
    outH = Math.max(1, Math.round(opts.pixelCrop.height * scale));
  }

  canvas.width = outW;
  canvas.height = outH;
  ctx.clearRect(0, 0, outW, outH);
  ctx.drawImage(
    image,
    opts.pixelCrop.x,
    opts.pixelCrop.y,
    opts.pixelCrop.width,
    opts.pixelCrop.height,
    0,
    0,
    outW,
    outH
  );

  const preferPng = opts.preferPng !== false;
  const hasAlpha = canvasHasTransparency(ctx, outW, outH);
  const name = opts.fileName?.replace(/\.[^.]+$/, "") || "image";

  if (preferPng || hasAlpha) {
    const png = await blobFromCanvas(canvas, "image/png");
    if (png && png.size <= opts.maxBytes) {
      return new File([png], `${name}.png`, { type: "image/png" });
    }
    const webp = await blobFromCanvas(canvas, "image/webp", 0.92);
    if (webp && webp.size <= opts.maxBytes) {
      return new File([webp], `${name}.webp`, { type: "image/webp" });
    }
    if (hasAlpha) {
      throw new Error(
        `Не удалось уложить PNG с прозрачностью в ${Math.round(opts.maxBytes / (1024 * 1024))} МБ.`
      );
    }
  }

  const qualities = [0.92, 0.85, 0.75, 0.65, 0.55, 0.45];
  let blob: Blob | null = null;
  for (const q of qualities) {
    blob = await blobFromCanvas(canvas, "image/jpeg", q);
    if (blob && blob.size <= opts.maxBytes) break;
  }
  if (!blob) throw new Error("Не удалось сжать изображение");
  if (blob.size > opts.maxBytes) {
    throw new Error(
      `Не удалось уложить кадр в ${Math.round(opts.maxBytes / (1024 * 1024))} МБ. Выберите другое фото.`
    );
  }
  return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
}

/** @deprecated use getCroppedImage */
export async function getCroppedJpeg(
  opts: Parameters<typeof getCroppedImage>[0]
): Promise<File> {
  return getCroppedImage({ ...opts, preferPng: false });
}
