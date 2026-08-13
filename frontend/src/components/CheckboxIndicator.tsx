interface CheckboxIndicatorProps {
  checked: boolean;
  /** Unfinished after deadline / failed close — muted red cross. */
  failed?: boolean;
  /** Shared checklist: item claimed / in progress. */
  claimed?: boolean;
  className?: string;
}

export function CheckboxIndicator({
  checked,
  failed = false,
  claimed = false,
  className = "",
}: CheckboxIndicatorProps) {
  const showFail = failed && !checked;
  const showClaimed = claimed && !checked && !showFail;

  return (
    <span
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-2 transition ${
        checked
          ? "border-orange-400 bg-orange-400 text-white"
          : showClaimed
            ? "border-sky-400 bg-sky-50 text-sky-600"
            : showFail
              ? "border-red-300/70 bg-red-50/80 text-red-400/80"
              : "border-gray-300 bg-white"
      } ${className}`}
      aria-hidden
    >
      {checked && (
        <svg viewBox="0 0 12 10" className="h-3 w-3 fill-none stroke-current stroke-[2.5]">
          <path d="M1 5.5L4.5 9L11 1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {showClaimed && (
        <svg viewBox="0 0 12 12" className="h-3 w-3 fill-current">
          <path d="M3.2 2.1v7.8c0 .5.55.8.97.55l6.1-3.9a.65.65 0 0 0 0-1.1l-6.1-3.9a.65.65 0 0 0-.97.55Z" />
        </svg>
      )}
      {showFail && (
        <svg viewBox="0 0 12 12" className="h-3 w-3 fill-none stroke-current stroke-[2]">
          <path d="M2.5 2.5L9.5 9.5M9.5 2.5L2.5 9.5" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}
