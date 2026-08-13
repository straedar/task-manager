import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { BrandMark } from "../components/BrandMark";
import { HubLogoutButton } from "../components/HubLogoutButton";
import { HubProfileBanner } from "../components/HubProfileBanner";
import { hubAppsFromDto, type MiniAppDef } from "../apps";
import type { UserProfile } from "../types";
import { api } from "../api/client";

export function HubPage() {
  const { user, loading: authLoading, can } = useAuth();
  const navigate = useNavigate();
  const [apps, setApps] = useState<MiniAppDef[]>([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setAppsLoading(true);
    Promise.all([api.listHubApps(), api.getProfile().catch(() => null)])
      .then(([hub, profileRes]) => {
        if (cancelled) return;
        setApps(hubAppsFromDto(hub.apps));
        if (profileRes) setProfile(profileRes.profile);
      })
      .catch(() => {
        if (!cancelled) setApps([]);
      })
      .finally(() => {
        if (!cancelled) setAppsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-400">
        Загрузка...
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  const visibleApps = apps.filter((app) => can(app.permission));

  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg overflow-x-clip px-4 pb-10 pt-6">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <BrandMark size={44} toHub />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight gradient-text sm:text-3xl">
              TaskMaster
            </h1>
          </div>
        </div>
        <HubLogoutButton />
      </header>

      {profile && (
        <HubProfileBanner profile={profile} onOpen={() => navigate("/profile")} />
      )}

      {appsLoading ? (
        <p className="py-12 text-center text-sm text-gray-400">Загрузка...</p>
      ) : visibleApps.length === 0 ? (
        <p className="rounded-3xl bg-white py-12 text-center text-sm text-gray-400 shadow-soft">
          Нет доступных приложений для вашей роли
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {visibleApps.map((app) => {
            const Icon = app.icon;
            const soon = app.status === "soon";
            return (
              <button
                key={app.id}
                type="button"
                onClick={() => navigate(app.path)}
                className="group relative flex min-h-[9.5rem] flex-col items-start overflow-hidden rounded-3xl bg-white p-4 text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl gradient-accent text-white shadow">
                  <Icon className="h-5 w-5" strokeWidth={2.25} />
                </span>
                <span className="text-[15px] font-semibold text-gray-900">{app.title}</span>
                <span className="mt-1 line-clamp-2 text-xs leading-snug text-gray-400">
                  {app.description}
                </span>
                {soon && (
                  <span className="mt-auto pt-3 text-[11px] font-semibold uppercase tracking-wide text-orange-500">
                    Скоро
                  </span>
                )}
                {!soon && (
                  <span className="mt-auto pt-3 text-[11px] font-medium text-gray-400 opacity-0 transition group-hover:opacity-100">
                    Открыть →
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
