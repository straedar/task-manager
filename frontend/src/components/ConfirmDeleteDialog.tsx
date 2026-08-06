import type { ReactNode } from "react";
import { AppDialog } from "./AppDialog";

interface ConfirmDeleteDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  preview?: ReactNode;
}

/** Themed delete confirmation (TaskMaster style). */
export function ConfirmDeleteDialog({
  open,
  title,
  description = "Это действие нельзя отменить.",
  confirmLabel = "Удалить",
  loading = false,
  onConfirm,
  onCancel,
  preview,
}: ConfirmDeleteDialogProps) {
  return (
    <AppDialog
      open={open}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      loading={loading}
      variant="danger"
      preview={preview}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
