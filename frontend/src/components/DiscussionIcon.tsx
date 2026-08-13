import { MessageCircle } from "lucide-react";
import type { ChatIndicator } from "../types";

type DiscussionIconProps = {
  chat?: ChatIndicator | null;
  className?: string;
};

/** Иконка обсуждения: без точки / зелёная (прочитано) / красная (новое). */
export function DiscussionIcon({ chat, className = "h-4 w-4" }: DiscussionIconProps) {
  const count = chat?.message_count ?? 0;
  const unread = Boolean(chat?.has_unread);
  const label =
    count === 0
      ? "Обсуждение"
      : unread
        ? "Есть новые сообщения"
        : "Есть сообщения";

  return (
    <span className="relative inline-flex shrink-0" title={label} aria-label={label}>
      <MessageCircle className={`${className} text-gray-300`} aria-hidden />
      {count > 0 && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-white ${
            unread ? "bg-red-500" : "bg-emerald-500"
          }`}
          aria-hidden
        />
      )}
    </span>
  );
}
