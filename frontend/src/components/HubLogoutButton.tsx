import { LogOut } from "lucide-react";
import { useAuth } from "../context/AuthContext";

/** Standalone logout control for hub / app headers. */
export function HubLogoutButton({ dark = false }: { dark?: boolean }) {
  const { logout } = useAuth();

  const className = dark
    ? "flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/15 hover:text-red-300"
    : "flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface)] text-[var(--text-muted)] shadow-soft transition hover:bg-red-50 hover:text-red-500";

  return (
    <button
      type="button"
      onClick={() => void logout()}
      className={className}
      aria-label="Выйти"
      title="Выйти"
    >
      <LogOut className="h-5 w-5" />
    </button>
  );
}

/** @deprecated use HubLogoutButton */
export const HubAccountMenu = HubLogoutButton;
