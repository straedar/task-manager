import { useEffect, useRef, useState } from "react";
import { Building2, Home, Newspaper, Plus, Rocket } from "lucide-react";
import type { NewsChannel } from "../types";

type Props = {
  feed: NewsChannel;
  lastNewsFeed: "company" | "warehouse";
  canCreateNews: boolean;
  canReleasePatch: boolean;
  onFeedChange: (feed: NewsChannel) => void;
  onCreate: () => void;
};

function iconBtn(active: boolean, large = false) {
  const size = large
    ? "h-12 w-12 sm:h-14 sm:w-14"
    : "h-11 w-11 sm:h-12 sm:w-12";
  return `flex ${size} shrink-0 items-center justify-center rounded-full transition ${
    active
      ? "gradient-accent text-white shadow-md"
      : "bg-gray-900 text-gray-400 shadow-md hover:text-white"
  }`;
}

export function NewsBottomNav({
  feed,
  lastNewsFeed,
  canCreateNews,
  canReleasePatch,
  onFeedChange,
  onCreate,
}: Props) {
  const onNews = feed === "company" || feed === "warehouse";
  const showCreate =
    (onNews && canCreateNews) || (feed === "patch" && canReleasePatch);

  const [menuOpen, setMenuOpen] = useState(onNews);
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setMenuOpen(onNews);
  }, [onNews]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent | TouchEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) {
        if (!onNews) setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
    };
  }, [menuOpen, onNews]);

  const openNewsMenu = () => {
    if (!onNews) {
      onFeedChange(lastNewsFeed);
      setMenuOpen(true);
      return;
    }
    setMenuOpen((v) => !v);
  };

  return (
    <nav
      ref={rootRef}
      className="pointer-events-none fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 z-40 w-full max-w-2xl -translate-x-1/2 px-4 sm:bottom-6"
    >
      <div className="relative flex min-h-14 items-end justify-center sm:min-h-16">
        {/* Одна пилюля: новости + патчноут */}
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-gray-900 px-2 py-2 shadow-lg sm:gap-2 sm:px-2.5 sm:py-2.5">
          {/* Меню растёт вверх от кнопки «Новости», не отдельной пилюлей */}
          <div className="relative flex items-center justify-center">
            {menuOpen && (
              <div
                className="absolute bottom-full left-1/2 z-10 mb-2 flex -translate-x-1/2 flex-col items-center gap-2 sm:mb-2.5 sm:gap-2.5"
                role="menu"
                aria-label="Канал новостей"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onFeedChange("company");
                    setMenuOpen(true);
                  }}
                  className={`${iconBtn(feed === "company")} animate-news-fan origin-bottom`}
                  style={{ animationDelay: "40ms" }}
                  aria-label="Новости компании"
                  aria-current={feed === "company" ? "page" : undefined}
                >
                  <Building2 className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={2} />
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onFeedChange("warehouse");
                    setMenuOpen(true);
                  }}
                  className={`${iconBtn(feed === "warehouse")} animate-news-fan origin-bottom`}
                  style={{ animationDelay: "0ms" }}
                  aria-label="Новости склада"
                  aria-current={feed === "warehouse" ? "page" : undefined}
                >
                  <Home className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={2} />
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={openNewsMenu}
              className={iconBtn(onNews, true)}
              aria-label="Новости"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-current={onNews ? "page" : undefined}
            >
              <Newspaper className="h-6 w-6 sm:h-7 sm:w-7" strokeWidth={2} />
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onFeedChange("patch");
            }}
            className={iconBtn(feed === "patch", true)}
            aria-label="Патчноуты"
            aria-current={feed === "patch" ? "page" : undefined}
          >
            <Rocket className="h-6 w-6 sm:h-7 sm:w-7" strokeWidth={2} />
          </button>
        </div>

        {showCreate && (
          <button
            type="button"
            onClick={onCreate}
            className="pointer-events-auto absolute bottom-0 right-0 flex h-14 w-14 items-center justify-center rounded-full gradient-accent text-white shadow-lg transition hover:scale-105 sm:h-16 sm:w-16"
            aria-label={
              feed === "patch" ? "Выпустить патчноут" : "Написать новость"
            }
          >
            <Plus className="h-7 w-7 sm:h-8 sm:w-8" strokeWidth={2.5} />
          </button>
        )}
      </div>
    </nav>
  );
}
