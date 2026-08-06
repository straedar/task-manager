import { useCallback, useEffect, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Modal } from "./Modal";
import { getCroppedImage } from "../utils/cropImage";
import {
  ALLOWED_IMAGE_MIME_LABEL,
  AVATAR_OUTPUT_SIZE,
  IMAGE_UPLOAD_MAX_BYTES,
  MISC_MAX_SIDE,
  imageLimitsHint,
} from "../utils/imageUpload";

export type ImageCropPreset = "avatar" | "misc";

export interface ImageCropDialogProps {
  open: boolean;
  imageSrc: string | null;
  onClose: () => void;
  onConfirm: (file: File) => void | Promise<void>;
  /** avatar = 1:1 → 512px; misc = free aspect → maxSide 1280 */
  preset?: ImageCropPreset;
  title?: string;
  confirmLabel?: string;
}

export function ImageCropDialog({
  open,
  imageSrc,
  onClose,
  onConfirm,
  preset = "avatar",
  title = "Обрезка фото",
  confirmLabel = "Сохранить",
}: ImageCropDialogProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const aspect = preset === "avatar" ? 1 : undefined;
  const hint =
    preset === "avatar"
      ? imageLimitsHint({ outputSize: AVATAR_OUTPUT_SIZE })
      : imageLimitsHint({ maxSide: MISC_MAX_SIDE });

  useEffect(() => {
    if (!open) return;
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    setError("");
    setBusy(false);
  }, [open, imageSrc]);

  const onCropComplete = useCallback((_area: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels);
  }, []);

  const handleConfirm = async () => {
    if (!imageSrc || !croppedAreaPixels) return;
    setBusy(true);
    setError("");
    try {
      const file = await getCroppedImage({
        imageSrc,
        pixelCrop: croppedAreaPixels,
        outputSize: preset === "avatar" ? AVATAR_OUTPUT_SIZE : undefined,
        maxSide: preset === "misc" ? MISC_MAX_SIDE : undefined,
        maxBytes: IMAGE_UPLOAD_MAX_BYTES,
        fileName: "upload",
        preferPng: true,
      });
      await onConfirm(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось обрезать");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open && Boolean(imageSrc)}
      onClose={() => !busy && onClose()}
      title={title}
      maxWidth="sm:max-w-xl"
    >
      <div className="flex flex-col gap-4 p-5">
        <p className="text-xs leading-relaxed text-[var(--text-muted)]">{hint}</p>

        <div className="relative h-72 w-full overflow-hidden rounded-2xl bg-black/80">
          {imageSrc && (
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={aspect}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
              showGrid
            />
          )}
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-[var(--text-muted)]">Масштаб</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="w-full accent-[var(--accent-from)]"
            disabled={busy}
          />
        </label>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <p className="text-[11px] text-[var(--text-faint)]">
          Форматы: {ALLOWED_IMAGE_MIME_LABEL}. Перетащите кадр и приблизьте колесом / ползунком.
        </p>

        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="flex-1 rounded-xl border border-[var(--border)] py-3 text-sm font-medium text-[var(--text-secondary)] disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={busy || !croppedAreaPixels}
            onClick={() => void handleConfirm()}
            className="flex-1 rounded-xl py-3 text-sm font-medium text-white gradient-accent disabled:opacity-50"
          >
            {busy ? "Сохранение..." : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
