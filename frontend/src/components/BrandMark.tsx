import { useNavigate } from "react-router-dom";

/** Brand eye — transparent PNG (no black square), works on any theme. */
export function BrandMark({
  size = 40,
  className = "",
  toHub = false,
}: {
  size?: number;
  className?: string;
  /** If true, clicking navigates to the hub `/`. */
  toHub?: boolean;
}) {
  const navigate = useNavigate();

  const mark = (
    <img
      src="/brand-mark.png?v=10"
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={`shrink-0 object-contain ${className}`}
      aria-hidden={toHub ? undefined : true}
    />
  );

  if (!toHub) {
    return (
      <span className="inline-flex shrink-0" role="img" aria-label="TaskMaster">
        {mark}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => navigate("/")}
      className="inline-flex shrink-0 transition hover:opacity-90 active:scale-95"
      aria-label="На главный экран TaskMaster"
      title="На главную"
    >
      {mark}
    </button>
  );
}
