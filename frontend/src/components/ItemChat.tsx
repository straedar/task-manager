import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Send } from "lucide-react";
import { api } from "../api/client";
import { formatTaskDate } from "../utils/date";
import type { ItemMessage } from "../types";

const POLL_MS = 8000;

type ItemChatProps = {
  kind: "task" | "checklist";
  refId: number;
  currentUserId: number;
};

export function ItemChat({ kind, refId, currentUserId }: ItemChatProps) {
  const [messages, setMessages] = useState<ItemMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(
    async (silent = false) => {
      try {
        const { messages: next } =
          kind === "task"
            ? await api.listTaskMessages(refId)
            : await api.listChecklistMessages(refId);
        setMessages(next);
        setError("");
      } catch (err) {
        if (!silent) {
          setError(err instanceof Error ? err.message : "Не удалось загрузить чат");
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [kind, refId]
  );

  useEffect(() => {
    setLoading(true);
    void refresh(false);
  }, [refresh]);

  useEffect(() => {
    const tick = () => {
      if (document.hidden || sending) return;
      void refresh(true);
    };
    const id = window.setInterval(tick, POLL_MS);
    const onVis = () => {
      if (!document.hidden) void refresh(true);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh, sending]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError("");
    try {
      const { message } =
        kind === "task"
          ? await api.postTaskMessage(refId, body)
          : await api.postChecklistMessage(refId, body);
      setMessages((prev) => [...prev, message]);
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отправить");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex min-h-[20rem] flex-1 flex-col rounded-3xl bg-white shadow-soft">
      <div className="border-b border-gray-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900">Обсуждение</h2>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {loading ? (
          <p className="py-8 text-center text-sm text-gray-400">Загрузка...</p>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">
            Пока нет сообщений — напишите первым
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.user_id === currentUserId;
            return (
              <div
                key={m.id}
                className={`flex flex-col ${mine ? "items-end" : "items-start"}`}
              >
                <p className="mb-0.5 px-1 text-[11px] text-gray-400">
                  {mine ? "Вы" : m.author_nickname} · {formatTaskDate(m.created_at)}
                </p>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-snug ${
                    mine
                      ? "rounded-br-md bg-orange-500 text-white"
                      : "rounded-bl-md bg-gray-100 text-gray-900"
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="flex items-end gap-2 border-t border-gray-100 p-3"
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Написать сообщение..."
          className="min-h-[2.75rem] flex-1 resize-none rounded-2xl border border-gray-200 px-3.5 py-2.5 text-sm outline-none focus:border-orange-400"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit(e);
            }
          }}
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white gradient-accent disabled:opacity-40"
          aria-label="Отправить"
          title="Отправить"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
      {error && <p className="px-4 pb-3 text-sm text-red-500">{error}</p>}
    </div>
  );
}
