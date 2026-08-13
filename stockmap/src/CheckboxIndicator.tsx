type Props = {
  checked: boolean;
  className?: string;
};

/** Визуальный чекбокс в стиле Task Manager (оранжевая рамка / галочка). */
export function CheckboxIndicator({ checked, className = "" }: Props) {
  return (
    <span
      className={`checkbox-indicator${checked ? " is-checked" : ""}${
        className ? ` ${className}` : ""
      }`}
      aria-hidden
    >
      {checked && (
        <svg viewBox="0 0 12 10" className="checkbox-indicator-mark" fill="none">
          <path
            d="M1 5.5L4.5 9L11 1"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  );
}
