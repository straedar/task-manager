import { ChevronRight } from "lucide-react";
import type { ProfileKpi, UserProfile } from "../types";
import { displayName, initialsOf } from "../types";

const KPI_ITEMS: { key: keyof ProfileKpi; label: string }[] = [
  { key: "completed", label: "Готово" },
  { key: "expired", label: "Просрочено" },
  { key: "active", label: "В работе" },
  { key: "expecting", label: "Ожидают" },
];

export function HubProfileBanner({
  profile,
  onOpen,
}: {
  profile: UserProfile;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mb-5 flex w-full flex-col gap-3 rounded-3xl bg-[var(--surface)] p-4 text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-center gap-3">
        <div
          className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl text-white shadow ${
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
            <span className="flex h-full w-full items-center justify-center text-lg font-semibold">
              {initialsOf(profile)}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-[var(--text-primary)]">
            {displayName(profile)}
          </p>
          <p className="mt-0.5 truncate text-sm text-[var(--text-muted)]">
            {profile.role_name?.trim() || "Без роли"}
            {profile.first_name || profile.last_name
              ? ` · @${profile.nickname}`
              : ""}
          </p>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-[var(--text-faint)]" />
      </div>

      <div className="grid grid-cols-4 gap-2 border-t border-[var(--border)] pt-3">
        {KPI_ITEMS.map((item) => (
          <div key={item.key} className="min-w-0 text-center">
            <p className="text-base font-semibold tabular-nums text-[var(--text-primary)]">
              {profile.kpi[item.key]}
            </p>
            <p className="truncate text-[10px] font-medium uppercase tracking-wide text-[var(--text-faint)]">
              {item.label}
            </p>
          </div>
        ))}
      </div>
    </button>
  );
}
