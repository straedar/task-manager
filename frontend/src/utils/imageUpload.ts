/** Client-side limits (keep in sync with backend/src/uploads/store.ts). */

export const IMAGE_SOURCE_MAX_BYTES = 10 * 1024 * 1024;
export const IMAGE_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_OUTPUT_SIZE = 512;
export const MISC_MAX_SIDE = 1280;

export const ALLOWED_IMAGE_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const ALLOWED_IMAGE_MIME_LABEL = "JPEG, PNG или WebP";

export function formatBytesMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return Number.isInteger(mb) ? String(mb) : mb.toFixed(1);
}

export function isAllowedImageFile(file: File): boolean {
  if (ALLOWED_IMAGE_MIMES.includes(file.type as (typeof ALLOWED_IMAGE_MIMES)[number])) {
    return true;
  }
  // Some browsers omit type — fall back to extension.
  const name = file.name.toLowerCase();
  return /\.(jpe?g|png|webp)$/.test(name);
}

export function validateImageSource(file: File): string | null {
  if (!isAllowedImageFile(file)) {
    return `Допустимы только ${ALLOWED_IMAGE_MIME_LABEL}. HEIC с iPhone пока не поддерживается — экспортируйте в JPEG.`;
  }
  if (file.size > IMAGE_SOURCE_MAX_BYTES) {
    return `Файл слишком большой. Исходник — максимум ${formatBytesMb(IMAGE_SOURCE_MAX_BYTES)} МБ.`;
  }
  return null;
}

export function imageLimitsHint(opts: {
  outputSize?: number;
  maxSide?: number;
}): string {
  const out =
    opts.outputSize != null
      ? `${opts.outputSize}×${opts.outputSize} PNG`
      : opts.maxSide != null
        ? `до ${opts.maxSide}px по длинной стороне`
        : "сжатый кадр";
  return `${ALLOWED_IMAGE_MIME_LABEL}; исходник до ${formatBytesMb(IMAGE_SOURCE_MAX_BYTES)} МБ; на сервер — до ${formatBytesMb(IMAGE_UPLOAD_MAX_BYTES)} МБ, ${out} (прозрачность сохраняется).`;
}
