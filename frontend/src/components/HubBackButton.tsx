import { BrandMark } from "./BrandMark";
import { useNavigate } from "react-router-dom";

/** Compact control to return from a mini-app to the TaskMaster hub. */
export function HubBackButton({ className = "" }: { className?: string }) {
  const navigate = useNavigate();
  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <BrandMark size={36} toHub />
      <button
        type="button"
        onClick={() => navigate("/")}
        className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-2 text-sm font-medium text-gray-600 shadow-soft transition hover:text-orange-600"
        aria-label="В TaskMaster"
        title="В TaskMaster"
      >
        TaskMaster
      </button>
    </div>
  );
}
