import multer from "multer";
import { ALLOWED_IMAGE_MIMES, IMAGE_UPLOAD_MAX_BYTES } from "./store.js";

export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGE_UPLOAD_MAX_BYTES },
  fileFilter(_req, file, cb) {
    if (ALLOWED_IMAGE_MIMES.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error("INVALID_IMAGE_TYPE"));
  },
});

export function imageUploadErrorMessage(err: unknown): string {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return "Файл слишком большой (макс. 2 МБ)";
    }
    return err.message;
  }
  if (err instanceof Error) {
    if (err.message === "INVALID_IMAGE_TYPE") {
      return "Допустимы только JPEG, PNG или WebP";
    }
    return err.message;
  }
  return "Ошибка загрузки";
}

export { IMAGE_UPLOAD_MAX_BYTES, ALLOWED_IMAGE_MIMES } from "./store.js";
