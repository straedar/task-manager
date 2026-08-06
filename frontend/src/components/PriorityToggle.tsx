import type { TaskPriority } from "../types";
import { PRIORITY_LABELS } from "../types";

const PRIORITIES: TaskPriority[] = ["low", "medium", "high"];

const styles: Record<TaskPriority, { active: string; idle: string }> = {
  low: {
    active: "bg-gray-700 text-white shadow-md",
    idle: "text-gray-500 hover:bg-gray-100",
  },
  medium: {
    active: "gradient-accent text-white shadow-md",
    idle: "text-gray-500 hover:bg-orange-50",
  },
  high: {
    active: "bg-red-500 text-white shadow-md",
    idle: "text-gray-500 hover:bg-red-50",
  },
};

interface PriorityToggleProps {
  value: TaskPriority;
  onChange: (value: TaskPriority) => void;
}

export function PriorityToggle({ value, onChange }: PriorityToggleProps) {
  return (
    <div className="flex w-full rounded-2xl bg-gray-100 p-1 shadow-inner">
      {PRIORITIES.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onChange(p)}
          className={`flex-1 rounded-xl py-2.5 text-sm font-medium transition-all duration-200 ${
            value === p ? styles[p].active : styles[p].idle
          }`}
        >
          {PRIORITY_LABELS[p]}
        </button>
      ))}
    </div>
  );
}
