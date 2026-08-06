import { Navigate } from "react-router-dom";
import { Zap } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { TaskList } from "../components/TaskList";
import { BottomNav } from "../components/BottomNav";
import { HubLogoutButton } from "../components/HubLogoutButton";
import { HubBackButton } from "../components/HubBackButton";
import { useTaskPolling } from "../hooks/useTaskPolling";
import { isRoot } from "../types";

export function HomePage() {
  const { user, loading: authLoading, can } = useAuth();
  const {
    tasks,
    checklists,
    loading,
    actingId,
    actingChecklistId,
    refresh,
    handleStart,
    handleComplete,
    handleDelete,
    handleToggleChecklistItem,
    handleDeleteChecklist,
  } = useTaskPolling(Boolean(user));

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-400">
        Загрузка...
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (!can("app.tasks")) return <Navigate to="/" replace />;

  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg overflow-x-clip px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-6">
      <header className="mb-6 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="mb-2">
            <HubBackButton />
          </div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <Zap className="h-7 w-7 shrink-0 text-orange-500" />
            Менеджер задач
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {user.nickname} · {isRoot(user) ? "Корень" : "В структуре"}
          </p>
        </div>
        <div className="shrink-0 pt-1">
          <HubLogoutButton />
        </div>
      </header>

      {loading ? (
        <p className="py-12 text-center text-gray-400">Загрузка задач...</p>
      ) : (
        <TaskList
          tasks={tasks}
          checklists={checklists}
          currentUserId={user.id}
          isAdmin={can("tasks.manage_any")}
          onStart={handleStart}
          onComplete={handleComplete}
          onDelete={handleDelete}
          onToggleChecklistItem={handleToggleChecklistItem}
          onDeleteChecklist={handleDeleteChecklist}
          onUpdated={() => refresh(true)}
          actingId={actingId}
          actingChecklistId={actingChecklistId}
        />
      )}

      <BottomNav onTaskCreated={() => refresh(true)} />
    </div>
  );
}
