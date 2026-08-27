import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { ItemChat } from "../components/ItemChat";
import { ChecklistItemRow } from "../components/ChecklistItemRow";
import type { Checklist } from "../types";
import { formatMoscowDeadline, formatTaskDate } from "../utils/date";
import {
  checklistShowsFailedItems,
  isChecklistOverdue,
} from "../utils/checklistStatus";
import {
  nextChecklistItemAction,
  type ChecklistItemAction,
} from "../utils/checklistItemAction";
import { isRoot } from "../types";

export function ChecklistDetailPage() {
  const { id: idParam } = useParams<{ id: string }>();
  const id = Number(idParam);
  const { user, loading: authLoading, can } = useAuth();
  const navigate = useNavigate();
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acting, setActing] = useState(false);

  const refresh = useCallback(async () => {
    if (!Number.isFinite(id)) return;
    try {
      const { checklist: next } = await api.getChecklist(id);
      setChecklist(next);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить");
      setChecklist(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (user && can("app.tasks")) void refresh();
  }, [user, can, refresh]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-400">
        Загрузка...
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!can("app.tasks")) return <Navigate to="/" replace />;
  if (!Number.isFinite(id)) return <Navigate to="/tasks" replace />;

  const overdue = checklist ? isChecklistOverdue(checklist) : false;
  const showFailedItems = checklist ? checklistShowsFailedItems(checklist) : false;
  const isAdmin = Boolean(user && (isRoot(user) || can("tasks.manage_any")));
  const doneCount = checklist?.items.filter((i) => i.completed_at).length ?? 0;
  const total = checklist?.items.length ?? 0;
  const incompleteAfterClose = Boolean(
    checklist &&
      checklist.status === "completed" &&
      (checklist.auto_completed || checklist.items.some((i) => !i.completed_at))
  );
  const canRestore = Boolean(
    checklist &&
      (incompleteAfterClose || overdue) &&
      (checklist.assignee_id === user.id ||
        checklist.created_by === user.id ||
        isAdmin)
  );

  const toggleItem = async (
    itemId: number,
    payload?: boolean | { action: ChecklistItemAction }
  ) => {
    if (!checklist) return;
    const item = checklist.items.find((i) => i.id === itemId);
    if (!item) return;

    let body: boolean | { action: ChecklistItemAction };
    if (payload !== undefined) {
      body = payload;
    } else {
      const action = nextChecklistItemAction(checklist, item, user.id, isAdmin);
      if (!action || overdue) return;
      body = checklist.is_shared ? { action } : action === "complete";
    }

    setActing(true);
    try {
      const { checklist: next } = await api.toggleChecklistItem(
        checklist.id,
        itemId,
        body
      );
      setChecklist(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setActing(false);
    }
  };

  const restore = async () => {
    if (!checklist) return;
    setActing(true);
    try {
      const { checklist: next } = await api.restoreChecklist(checklist.id);
      setChecklist(next);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 pb-10 pt-6">
      <header className="mb-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-gray-600 shadow-soft hover:text-orange-600"
          aria-label="Назад"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Link to="/tasks" className="text-sm font-medium text-gray-500 hover:text-orange-600">
          К задачам
        </Link>
      </header>

      {loading ? (
        <p className="py-12 text-center text-gray-400">Загрузка...</p>
      ) : error && !checklist ? (
        <p className="rounded-3xl bg-white py-12 text-center text-sm text-red-500 shadow-soft">
          {error}
        </p>
      ) : checklist ? (
        <>
          <div
            className={`mb-4 rounded-3xl p-4 shadow-soft ${
              incompleteAfterClose || overdue ? "card-accent-alert" : "bg-white"
            }`}
          >
            <h1 className="text-xl font-bold text-gray-900">{checklist.title}</h1>
            <div className="mt-2 flex flex-wrap gap-1">
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                Чеклист
              </span>
              {checklist.is_shared && (
                <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-700">
                  Общий
                </span>
              )}
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                {doneCount}/{total}
              </span>
              {overdue && (
                <span className="badge-accent-alert rounded-full px-2 py-0.5 text-[11px] font-medium">
                  Просрочен
                </span>
              )}
              {checklist.status === "completed" && checklist.auto_completed && (
                <span className="badge-accent-alert rounded-full px-2 py-0.5 text-[11px] font-medium">
                  Просрочен
                </span>
              )}
              {incompleteAfterClose && !checklist.auto_completed && (
                <span className="badge-accent-alert rounded-full px-2 py-0.5 text-[11px] font-medium">
                  Не выполнен
                </span>
              )}
              {checklist.status === "completed" &&
                !incompleteAfterClose &&
                !checklist.auto_completed && (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
                    Выполнен
                  </span>
                )}
            </div>

            <ul className="mt-4 space-y-2">
              {checklist.items.map((item) => (
                <ChecklistItemRow
                  key={item.id}
                  checklist={checklist}
                  item={item}
                  currentUserId={user.id}
                  isAdmin={isAdmin}
                  overdue={overdue}
                  showFailedItems={showFailedItems}
                  incompleteAfterClose={incompleteAfterClose}
                  acting={acting}
                  onToggle={(itemId, payload) => void toggleItem(itemId, payload)}
                />
              ))}
            </ul>

            <div className="mt-3 space-y-0.5">
              <p className="text-xs text-gray-400">
                {checklist.is_shared
                  ? `Постановщик: ${checklist.creator.nickname}`
                  : `Исполнитель: ${checklist.assignee.nickname}`}
              </p>
              {!checklist.is_shared && (
                <p className="text-xs text-gray-400">
                  Создал: {checklist.creator.nickname}
                </p>
              )}
              <p className="text-xs text-gray-400">
                Создан: {formatTaskDate(checklist.created_at)}
              </p>
              {checklist.status === "open" && checklist.expires_at && (
                <p className="text-xs text-accent-alert">
                  {overdue
                    ? `Просрочен с ${formatMoscowDeadline(checklist.expires_at)}`
                    : `Срок до ${formatMoscowDeadline(checklist.expires_at)}`}
                </p>
              )}
            </div>

            {canRestore && (
              <button
                type="button"
                disabled={acting}
                onClick={() => void restore()}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-orange-200 bg-orange-50 py-3 text-sm font-medium text-orange-700 transition hover:bg-orange-100 disabled:opacity-50"
              >
                <RotateCcw className="h-4 w-4" />
                Восстановить в активные
              </button>
            )}
          </div>

          {error && (
            <p className="mb-3 text-center text-sm text-red-500">{error}</p>
          )}

          <ItemChat kind="checklist" refId={checklist.id} currentUserId={user.id} />
        </>
      ) : null}
    </div>
  );
}
