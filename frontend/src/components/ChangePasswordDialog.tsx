import { useEffect, useState } from "react";
import { api } from "../api/client";
import { Modal } from "./Modal";

interface ChangePasswordDialogProps {
  open: boolean;
  onClose: () => void;
}

const inputClass =
  "block w-full min-w-0 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100";

export function ChangePasswordDialog({ open, onClose }: ChangePasswordDialogProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError("");
    setSuccess(false);
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (newPassword.length < 4) {
      setError("Новый пароль — минимум 4 символа");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Пароли не совпадают");
      return;
    }

    setLoading(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сменить пароль");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Смена пароля">
      <form onSubmit={handleSubmit} className="flex w-full flex-col gap-4 p-5">
        <label className="block w-full">
          <span className="mb-1.5 block text-sm font-medium text-gray-700">Текущий пароль</span>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className={inputClass}
            autoComplete="current-password"
            required
          />
        </label>

        <label className="block w-full">
          <span className="mb-1.5 block text-sm font-medium text-gray-700">Новый пароль</span>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className={inputClass}
            autoComplete="new-password"
            required
            minLength={4}
          />
        </label>

        <label className="block w-full">
          <span className="mb-1.5 block text-sm font-medium text-gray-700">Повторите новый пароль</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={inputClass}
            autoComplete="new-password"
            required
            minLength={4}
          />
        </label>

        {error && <p className="text-sm text-red-500">{error}</p>}
        {success && <p className="text-sm text-green-600">Пароль успешно изменён</p>}

        <button
          type="submit"
          disabled={loading}
          className="rounded-2xl gradient-accent py-3.5 text-sm font-semibold text-white shadow transition hover:brightness-105 disabled:opacity-60"
        >
          {loading ? "Сохранение..." : "Сменить пароль"}
        </button>
      </form>
    </Modal>
  );
}
