import { useId } from "react";
import { useNavigate } from "react-router-dom";

/** Crisp SVG “eye” brand mark (favicon). Click opens TaskMaster hub when `toHub`. */
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
  const uid = useId().replace(/:/g, "");
  const glowId = `tm-glow-${uid}`;
  const irisId = `tm-iris-${uid}`;

  const mark = (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={`shrink-0 rounded-[22%] ${className}`}
      role="img"
      aria-hidden={toHub ? undefined : true}
      aria-label={toHub ? "TaskMaster — на главную" : "TaskMaster"}
    >
      <defs>
        <radialGradient id={glowId} cx="50%" cy="48%" r="45%">
          <stop offset="0%" stopColor="#ffe08a" />
          <stop offset="35%" stopColor="#ff9a3c" />
          <stop offset="70%" stopColor="#ff6b35" />
          <stop offset="100%" stopColor="#c43a10" />
        </radialGradient>
        <radialGradient id={irisId} cx="50%" cy="48%" r="55%">
          <stop offset="0%" stopColor="#2a1810" />
          <stop offset="55%" stopColor="#1a100c" />
          <stop offset="100%" stopColor="#0c0806" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="#141210" />
      <path
        fill="#0a0908"
        d="M6 32c6-14 16-22 26-22s20 8 26 22c-6 14-16 22-26 22S12 46 6 32z"
      />
      <path
        fill="#1c1814"
        d="M8 31c5.5-12 14.5-19 24-19s18.5 7 24 19c-1.2-1.5-4-3.5-8.5-5.5C41 22 36 20.5 32 20.5S23 22 16.5 25.5C12 27.5 9.2 29.5 8 31z"
      />
      <path
        fill="none"
        stroke="#3a322c"
        strokeWidth="1.4"
        strokeLinecap="round"
        d="M9 31c5-11 13.5-17.5 23-17.5S50 20 55 31"
      />
      <path
        fill="#161310"
        d="M8 33c5.5 11.5 14.5 18.5 24 18.5s18.5-7 24-18.5c-1.5 1.2-4.2 3-8.8 4.8C41 40.5 36.2 42 32 42s-9-1.5-15.2-4.2C12.2 36 9.5 34.2 8 33z"
      />
      <path
        fill="none"
        stroke="#2e2822"
        strokeWidth="1.2"
        strokeLinecap="round"
        d="M9 33c5 11 13.5 17 23 17s18-6 23-17"
      />
      <ellipse cx="32" cy="32" rx="22" ry="11.5" fill="#f4efe8" />
      <ellipse
        cx="32"
        cy="32"
        rx="22"
        ry="11.5"
        fill="none"
        stroke="#0a0908"
        strokeWidth="1.5"
      />
      <circle cx="32" cy="32" r="9.2" fill={`url(#${irisId})`} />
      <circle cx="32" cy="32" r="7.2" fill="#ff6b35" opacity="0.35" />
      <circle cx="32" cy="32" r="5.1" fill={`url(#${glowId})`} />
      <circle cx="32" cy="31.2" r="1.6" fill="#fff6c8" opacity="0.9" />
      <path
        fill="none"
        stroke="#4a4038"
        strokeWidth="0.8"
        strokeLinecap="round"
        opacity="0.7"
        d="M14 24c5-4 11-6 18-6s13 2 18 6"
      />
    </svg>
  );

  if (!toHub) return mark;

  return (
    <button
      type="button"
      onClick={() => navigate("/")}
      className="shrink-0 rounded-[22%] transition hover:opacity-90 active:scale-95"
      aria-label="На главный экран TaskMaster"
      title="На главную"
    >
      {mark}
    </button>
  );
}
