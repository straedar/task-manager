import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { Checklist, Task } from "../types";
import { isEditing } from "../lib/editingLock";

const POLL_INTERVAL_MS = 4000;

export function useTaskPolling(enabled: boolean) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<number | null>(null);
  const [actingChecklistId, setActingChecklistId] = useState<number | null>(null);

  const refresh = useCallback(async (silent = false) => {
    try {
      const [{ tasks: nextTasks }, { checklists: nextChecklists }] = await Promise.all([
        api.getTasks(),
        api.getChecklists(),
      ]);
      setTasks(nextTasks);
      setChecklists(nextChecklists);
    } catch {
      if (!silent) {
        setTasks([]);
        setChecklists([]);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh(false);
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) return;

    const tick = () => {
      if (document.hidden || actingId !== null || actingChecklistId !== null || isEditing()) {
        return;
      }
      refresh(true);
    };

    const intervalId = window.setInterval(tick, POLL_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (!document.hidden) refresh(true);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, refresh, actingId, actingChecklistId]);

  const handleStart = async (id: number) => {
    setActingId(id);
    try {
      await api.startTask(id);
      await refresh(true);
    } finally {
      setActingId(null);
    }
  };

  const handleComplete = async (id: number) => {
    setActingId(id);
    try {
      await api.completeTask(id);
      await refresh(true);
    } finally {
      setActingId(null);
    }
  };

  const handleDelete = async (id: number) => {
    setActingId(id);
    try {
      await api.deleteTask(id);
      await refresh(true);
    } finally {
      setActingId(null);
    }
  };

  const handleToggleChecklistItem = async (
    checklistId: number,
    itemId: number,
    completed: boolean
  ) => {
    setActingChecklistId(checklistId);
    try {
      await api.toggleChecklistItem(checklistId, itemId, completed);
      await refresh(true);
    } finally {
      setActingChecklistId(null);
    }
  };

  const handleDeleteChecklist = async (id: number) => {
    setActingChecklistId(id);
    try {
      await api.deleteChecklist(id);
      await refresh(true);
    } finally {
      setActingChecklistId(null);
    }
  };

  return {
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
  };
}
