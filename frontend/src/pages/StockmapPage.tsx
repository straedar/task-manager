import { Navigate, useSearchParams } from "react-router-dom";
import { useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import { STOCKMAP_EMBED_URL } from "../apps";

export function StockmapPage() {
  const { user, loading, can } = useAuth();
  const [params] = useSearchParams();

  const embedSrc = useMemo(() => {
    const q = params.get("q")?.trim();
    if (!q) return STOCKMAP_EMBED_URL;
    const url = new URL(STOCKMAP_EMBED_URL, window.location.origin);
    url.searchParams.set("q", q);
    return `${url.pathname}${url.search}`;
  }, [params]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-400">
        Загрузка...
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (!can("app.stockmap") && !can("stockmap.view")) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="h-dvh bg-gray-950">
      <iframe
        title="Карта склада"
        src={embedSrc}
        className="h-full w-full border-0 bg-black"
        allow="fullscreen"
      />
    </div>
  );
}
