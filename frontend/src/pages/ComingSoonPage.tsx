import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { hubAppsFromDto, type MiniAppDef } from "../apps";
import { HubBackButton } from "../components/HubBackButton";
import { api } from "../api/client";

const STUB_IDS = new Set(["orders"]);

export function ComingSoonPage() {
  const { appId } = useParams<{ appId: string }>();
  const { user, loading, can } = useAuth();
  const navigate = useNavigate();
  const [app, setApp] = useState<MiniAppDef | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!user || !appId) return;
    let cancelled = false;
    api
      .listHubApps()
      .then(({ apps }) => {
        if (cancelled) return;
        const found = hubAppsFromDto(apps).find((a) => a.id === appId) ?? null;
        setApp(found);
      })
      .catch(() => {
        if (!cancelled) setApp(null);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user, appId]);

  if (loading || !ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-400">
        Загрузка...
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (!appId || !STUB_IDS.has(appId)) return <Navigate to="/" replace />;
  if (!app || !can(app.permission)) return <Navigate to="/" replace />;

  const Icon = app.icon;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 pb-10 pt-6">
      <div className="mb-6">
        <HubBackButton />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center rounded-3xl bg-white p-8 text-center shadow-soft">
        <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50 text-orange-500">
          <Icon className="h-7 w-7" />
        </span>
        <h1 className="text-xl font-bold text-gray-900">{app.title}</h1>
        <p className="mt-2 text-sm text-gray-500">
          Раздел в разработке. Скоро появится здесь как отдельное мини-приложение.
        </p>
        <button
          type="button"
          onClick={() => navigate("/")}
          className="mt-6 rounded-2xl px-5 py-3 text-sm font-medium text-white gradient-accent"
        >
          Назад в TaskMaster
        </button>
      </div>
    </div>
  );
}
