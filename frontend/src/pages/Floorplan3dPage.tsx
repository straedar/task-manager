import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { FLOORPLAN_3D_EMBED_URL } from "../apps";

export function Floorplan3dPage() {
  const { user, loading, can } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-gray-400">
        Загрузка...
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (!can("app.floorplan3d") && !can("floorplan3d.view")) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="h-dvh bg-gray-950">
      <iframe
        title="3Д карта склада"
        src={FLOORPLAN_3D_EMBED_URL}
        className="h-full w-full border-0 bg-black"
        allow="fullscreen"
      />
    </div>
  );
}
