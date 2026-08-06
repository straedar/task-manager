interface ThemeSwitchProps {
  checked: boolean;
  onChange: () => void;
  label: string;
  id?: string;
}

/** iOS-style toggle; on-color follows theme `--accent-from`. */
export function ThemeSwitch({ checked, onChange, label, id }: ThemeSwitchProps) {
  return (
    <label
      htmlFor={id}
      className="theme-switch-row flex cursor-pointer items-center justify-between gap-3 rounded-xl px-2 py-2.5 text-sm text-gray-900"
    >
      <span className="min-w-0 flex-1 leading-snug">{label}</span>
      <span className="relative inline-flex shrink-0 items-center">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={onChange}
          className="peer sr-only"
        />
        <span
          className={`theme-switch ${checked ? "theme-switch--on" : ""}`}
          aria-hidden
        >
          <span className="theme-switch__knob" />
        </span>
      </span>
    </label>
  );
}
