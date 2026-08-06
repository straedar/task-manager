import { useEffect, useRef } from "react";
import { Bold, List, ListOrdered } from "lucide-react";

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

function exec(command: string) {
  document.execCommand(command, false);
}

export function NewsRichEditor({
  value,
  onChange,
  placeholder = "Текст новости…",
  disabled = false,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef(value);
  const focused = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Don't overwrite while the user is typing.
    if (focused.current && document.activeElement === el) return;
    const next = value || "";
    if (el.innerHTML !== next) {
      el.innerHTML = next;
    }
    lastEmitted.current = next;
  }, [value]);

  const emit = () => {
    const html = ref.current?.innerHTML ?? "";
    lastEmitted.current = html;
    onChange(html);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap gap-1 border-b border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1.5">
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-secondary)] transition hover:bg-[var(--surface)] hover:text-[var(--accent-from)] disabled:opacity-40"
          title="Жирный"
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            exec("bold");
            emit();
          }}
        >
          <Bold className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-secondary)] transition hover:bg-[var(--surface)] hover:text-[var(--accent-from)] disabled:opacity-40"
          title="Маркеры"
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            exec("insertUnorderedList");
            emit();
          }}
        >
          <List className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-secondary)] transition hover:bg-[var(--surface)] hover:text-[var(--accent-from)] disabled:opacity-40"
          title="Нумерация"
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            exec("insertOrderedList");
            emit();
          }}
        >
          <ListOrdered className="h-4 w-4" />
        </button>
      </div>
      <div
        ref={ref}
        className="news-body news-editor min-h-[12rem] px-4 py-3 text-[var(--text-primary)] outline-none"
        contentEditable={!disabled}
        role="textbox"
        aria-multiline
        data-placeholder={placeholder}
        suppressContentEditableWarning
        onFocus={() => {
          focused.current = true;
        }}
        onInput={emit}
        onBlur={() => {
          focused.current = false;
          emit();
        }}
      />
    </div>
  );
}
