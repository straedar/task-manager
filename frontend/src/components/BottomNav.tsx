import { CalendarDays, Lightbulb, Zap } from "lucide-react";
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
    {
      icon: CalendarDays,
      label: "Планировщик",
      path: "/tasks/planner",
      disabled: false,
      active: onPlanner,
      show: can("tasks.planner"),
    },
  ].filter((item) => item.show);

  const createFab =
    onIdeas && can("tasks.ideas") ? (
      <CreateIdeaDialog onCreated={() => onIdeaCreated?.()} />
    ) : can("tasks.create") ? (
      <CreateHomeAction onCreated={() => onTaskCreated?.()} />
    ) : null;

  return (
    <nav className="pointer-events-none fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 z-40 w-full max-w-lg -translate-x-1/2 px-4 sm:bottom-6">
      <div className="relative flex min-h-14 items-end justify-center sm:min-h-16">
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-gray-900 px-2 py-2 shadow-lg sm:gap-2 sm:px-3 sm:py-2.5">
          {items.map((item) => (
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
          ))}
        </div>

        {createFab && (
          <div className="pointer-events-auto absolute bottom-0 right-0">
            {createFab}
          </div>
        )}
      </div>
    </nav>
  );
}
