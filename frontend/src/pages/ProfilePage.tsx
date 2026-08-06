import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Camera, Pencil, Trash2, Trophy } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useDialog } from "../context/DialogContext";
import { HubBackButton } from "../components/HubBackButton";
import { ImageCropDialog } from "../components/ImageCropDialog";
import { Modal } from "../components/Modal";
import { ProfileSettingsMenu } from "../components/ProfileSettingsMenu";
import type { ProfileKpi, UserProfile } from "../types";
import { displayName, initialsOf } from "../types";
import {
  validateImageSource,
} from "../utils/imageUpload";

const KPI_ITEMS: { key: keyof ProfileKpi; label: string; hint: string }[] = [
  { key: "completed", label: "Выполнено", hint: "Успешно закрытые задачи и чеклисты" },
  { key: "expired", label: "Просрочено", hint: "Закрыты по сроку / не выполнены вовремя" },
  { key: "active", label: "В работе", hint: "Сейчас в процессе (в т.ч. открытые с дедлайном)" },
  { key: "expecting", label: "Ожидают", hint: "Ещё не начаты" },
];

const inputClass =
  "w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-from)]";

export function ProfilePage() {
  const { userId: userIdParam } = useParams<{ userId?: string }>();
  const { user, loading: authLoading, refresh, can } = useAuth();
  const { alert, confirm } = useDialog();
  const fileRef = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [editError, setEditError] = useState("");
  const [cropSrc, setCropSrc] = useState<string | null>(null);

  const targetId = userIdParam ? Number(userIdParam) : user?.id ?? null;
  const isOwn =
    Boolean(user) &&
    targetId != null &&
    Number.isInteger(targetId) &&
    targetId === user!.id;

  const load = useCallback(async () => {
    if (targetId == null || !Number.isInteger(targetId) || targetId < 1) {
      setError("Неверный профиль");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { profile: next } = isOwn
        ? await api.getProfile()
        : await api.getProfileById(targetId);
      setProfile(next);
      setFirstName(next.first_name);
      setLastName(next.last_name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки");
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [targetId, isOwn]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  useEffect(() => {
    return () => {
      if (cropSrc) URL.revokeObjectURL(cropSrc);
    };
  }, [cropSrc]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--text-faint)]">
        Загрузка...
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  if (
    userIdParam &&
    (!Number.isInteger(Number(userIdParam)) || Number(userIdParam) < 1)
  ) {
    return <Navigate to="/structure" replace />;
  }

  if (!isOwn && !can("app.structure")) {
    return <Navigate to="/" replace />;
  }

  const openEdit = () => {
    if (!profile) return;
    setFirstName(profile.first_name);
    setLastName(profile.last_name);
    setEditError("");
    setEditOpen(true);
  };

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!isOwn) return;
    setSaving(true);
    setEditError("");
    try {
      const res = await api.updateProfile({
        first_name: firstName,
        last_name: lastName,
      });
      setProfile(res.profile);
      await refresh();
      setEditOpen(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  const closeCrop = () => {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const onPickAvatarFile = async (file: File | undefined) => {
    if (!file || !isOwn) return;
    const invalid = validateImageSource(file);
    if (invalid) {
      await alert({
        title: "Нельзя загрузить это фото",
        description: invalid,
      });
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(URL.createObjectURL(file));
    if (fileRef.current) fileRef.current.value = "";
  };

  const onCropConfirm = async (file: File) => {
    setUploading(true);
    setError("");
    try {
      const res = await api.uploadAvatar(file);
      setProfile(res.profile);
      await refresh();
      closeCrop();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось загрузить фото";
      setError(message);
      await alert({ title: "Ошибка загрузки", description: message });
      throw err;
    } finally {
      setUploading(false);
    }
  };

  const onRemoveAvatar = async () => {
    if (!isOwn) return;
    const ok = await confirm({
      title: "Убрать фото профиля?",
      description: "Вернётся плейсхолдер с инициалами.",
      confirmLabel: "Убрать",
    });
    if (!ok) return;
    setUploading(true);
    try {
      const res = await api.deleteAvatar();
      setProfile(res.profile);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg px-4 pb-10 pt-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <HubBackButton />
        {isOwn ? (
          <ProfileSettingsMenu />
        ) : (
          <Link
            to="/structure"
            className="rounded-full bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] shadow-soft hover:text-[var(--accent-from)]"
          >
            К структуре
          </Link>
        )}
      </div>
      <h1 className="mb-6 text-2xl font-bold text-[var(--text-primary)]">
        {isOwn ? "Профиль" : "Профиль сотрудника"}
      </h1>

      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}

      {loading || !profile ? (
        <p className="py-12 text-center text-[var(--text-faint)]">Загрузка...</p>
      ) : (
        <div className="space-y-5">
          <section className="rounded-3xl bg-[var(--surface)] p-5 shadow-soft">
            <div className="flex flex-col items-center text-center">
              <div className="relative mb-3">
                <div
                  className={`h-24 w-24 overflow-hidden rounded-3xl text-white shadow ${
                    profile.avatar_url
                      ? "bg-[var(--surface-muted)]"
                      : "bg-gradient-to-br from-[var(--accent-from)] to-[var(--accent-to)]"
                  }`}
                >
                  {profile.avatar_url ? (
                    <img
                      src={profile.avatar_url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-2xl font-semibold">
                      {initialsOf(profile)}
                    </span>
                  )}
                </div>
                {isOwn && (
                  <>
                    <button
                      type="button"
                      disabled={uploading}
                      onClick={() => fileRef.current?.click()}
                      className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] shadow-soft hover:text-[var(--accent-from)] disabled:opacity-50"
                      aria-label="Загрузить фото"
                      title="Загрузить фото"
                    >
                      <Camera className="h-4 w-4" />
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                      className="hidden"
                      onChange={(e) => void onPickAvatarFile(e.target.files?.[0])}
                    />
                  </>
                )}
              </div>

              <div className="flex max-w-full items-center justify-center gap-1.5">
                <p className="truncate text-lg font-semibold text-[var(--text-primary)]">
                  {displayName(profile)}
                </p>
                {isOwn && (
                  <button
                    type="button"
                    onClick={openEdit}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--text-faint)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--accent-from)]"
                    aria-label="Изменить имя и фамилию"
                    title="Изменить имя и фамилию"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <p className="mt-0.5 text-sm text-[var(--text-muted)]">
                {profile.role_name?.trim() || "Без роли"} · @{profile.nickname}
              </p>
              {isOwn && profile.avatar_url && (
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => void onRemoveAvatar()}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-faint)] hover:text-red-500 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Убрать фото
                </button>
              )}
            </div>
          </section>

          <section className="rounded-3xl bg-[var(--surface)] p-4 shadow-soft">
            <p className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
              Задачи и чеклисты
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {KPI_ITEMS.map((item) => (
                <div
                  key={item.key}
                  className="rounded-2xl bg-[var(--surface-muted)] px-3 py-3 text-center"
                  title={item.hint}
                >
                  <p className="text-xl font-semibold tabular-nums text-[var(--text-primary)]">
                    {profile.kpi[item.key]}
                  </p>
                  <p className="mt-0.5 text-xs font-medium text-[var(--text-muted)]">
                    {item.label}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-dashed border-[var(--border)] bg-[var(--surface)]/60 p-5 text-center">
            <Trophy className="mx-auto mb-2 h-8 w-8 text-[var(--text-faint)]" />
            <p className="text-sm font-semibold text-[var(--text-primary)]">Достижения</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">Скоро появятся здесь</p>
          </section>
        </div>
      )}

      {isOwn && (
        <>
          <ImageCropDialog
            open={Boolean(cropSrc)}
            imageSrc={cropSrc}
            preset="avatar"
            title="Фото профиля"
            confirmLabel={uploading ? "Загрузка..." : "Сохранить"}
            onClose={() => {
              if (!uploading) closeCrop();
            }}
            onConfirm={onCropConfirm}
          />

          <Modal
            open={editOpen}
            onClose={() => !saving && setEditOpen(false)}
            title="Имя и фамилия"
          >
            <form onSubmit={(e) => void onSave(e)} className="flex flex-col gap-4 p-5">
              {editError && <p className="text-sm text-red-500">{editError}</p>}
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                  Имя
                </label>
                <input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  maxLength={80}
                  autoFocus
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">
                  Фамилия
                </label>
                <input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  maxLength={80}
                  className={inputClass}
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setEditOpen(false)}
                  className="flex-1 rounded-xl border border-[var(--border)] py-3 text-sm font-medium text-[var(--text-secondary)] disabled:opacity-50"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 rounded-xl py-3 text-sm font-medium text-white gradient-accent disabled:opacity-50"
                >
                  {saving ? "Сохранение..." : "Сохранить"}
                </button>
              </div>
            </form>
          </Modal>
        </>
      )}
    </div>
  );
}
