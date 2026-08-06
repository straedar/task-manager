interface CheckboxIndicatorProps {
  checked: boolean;
  className?: string;
}

export function CheckboxIndicator({ checked, className = "" }: CheckboxIndicatorProps) {
  return (
    <span
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-2 transition ${
        checked ? "border-orange-400 bg-orange-400 text-white" : "border-gray-300 bg-white"
      } ${className}`}
    >
      {checked && (
        <svg viewBox="0 0 12 10" className="h-3 w-3 fill-none stroke-current stroke-[2.5]">
          <path d="M1 5.5L4.5 9L11 1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}
