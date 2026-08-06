import type { User } from "../types";
import { CheckboxIndicator } from "./CheckboxIndicator";

interface AssigneePickerProps {
  users: User[];
  selectedIds: number[];
  onToggle: (id: number) => void;
}

export function AssigneePicker({ users, selectedIds, onToggle }: AssigneePickerProps) {
  return (
    <div className="flex w-full flex-col gap-2">
      {users.map((user) => {
        const selected = selectedIds.includes(user.id);
        return (
          <button
            key={user.id}
            type="button"
            onClick={() => onToggle(user.id)}
            className={`w-full rounded-2xl border px-4 py-3 text-left text-sm font-medium transition ${
              selected
                ? "border-orange-300 bg-orange-50 text-orange-700 shadow-sm"
                : "border-gray-200 bg-white text-gray-700 hover:border-orange-200 hover:bg-orange-50/50"
            }`}
          >
            <span className="flex items-center gap-3">
              <CheckboxIndicator checked={selected} />
              {user.nickname}
            </span>
          </button>
        );
      })}
    </div>
  );
}
