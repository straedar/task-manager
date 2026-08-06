import { CalendarDays, LayoutGrid, Lightbulb, Zap } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { CreateIdeaDialog } from "./CreateIdeaDialog";
import { CreateHomeAction } from "./CreateHomeAction";
import { useAuth } from "../context/AuthContext";

interface BottomNavProps {
  onTaskCreated?: () => void;
  onIdeaCreated?: () => void;
}

export function BottomNav({ onTaskCreated, onIdeaCreated }: BottomNavProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { can } = useAuth();
  const path = location.pathname;
  const onIdeas = path === "/tasks/ideas";
  const onPlanner = path === "/tasks/planner";
  const isTasksHome = path === "/tasks" || path === "/tasks/completed";

  const items = [
    {
      icon: LayoutGrid,
      label: "Хаб",
      path: "/",
      disabled: false,
      active: path === "/",
      show: true,
    },
    {
      icon: Zap,
      label: "Задачи",
      path: "/tasks",
      disabled: false,
      active: isTasksHome,
      show: can("app.tasks") && can("tasks.view"),
    },
    {
      icon: Lightbulb,
      label: "Идеи",
      path: "/tasks/ideas",
      disabled: false,
      active: onIdeas,
      show: can("tasks.ideas"),
    },
    { isAdd: true as const, label: "Создать", show: can("tasks.create") || can("tasks.ideas") },
    {
      icon: CalendarDays,
      label: "Планировщик",
      path: "/tasks/planner",
      disabled: false,
      active: onPlanner,
      show: can("tasks.planner"),
    },
  ].filter((item) => item.show);

  return (
    <nav className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 z-40 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 items-center gap-1.5 rounded-full bg-gray-900 px-2 py-2 shadow-lg sm:bottom-6 sm:gap-2 sm:px-3 sm:py-2.5">
      {items.map((item) =>
        "isAdd" in item && item.isAdd ? (
          onIdeas && can("tasks.ideas") ? (
            <CreateIdeaDialog key="add-idea" onCreated={() => onIdeaCreated?.()} />
          ) : can("tasks.create") ? (
            <CreateHomeAction key="add-home" onCreated={() => onTaskCreated?.()} />
          ) : null
        ) : !("isAdd" in item) ? (
          <button
            key={item.label}
            onClick={() => item.path && navigate(item.path)}
            disabled={item.disabled}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition sm:h-11 sm:w-11 ${
              item.active
                ? "gradient-accent text-white"
                : item.disabled
                  ? "cursor-not-allowed text-gray-600"
                  : "text-gray-400 hover:text-white"
            }`}
            aria-label={item.label}
          >
            <item.icon className="h-5 w-5" />
          </button>
        ) : null
      )}
    </nav>
  );
}
