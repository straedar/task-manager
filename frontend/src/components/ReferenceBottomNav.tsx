import { Bolt, Package, Plus } from "lucide-react";
import type { ReferenceKind } from "../types";

type Props = {
  tab: ReferenceKind;
  visibleTabs: ReferenceKind[];
  canCreate: boolean;
  onTabChange: (tab: ReferenceKind) => void;
  onCreate: () => void;
};

export function ReferenceBottomNav({
  tab,
  visibleTabs,
  canCreate,
  onTabChange,
  onCreate,
}: Props) {
  const showProducts = visibleTabs.includes("products");
  const showComponents = visibleTabs.includes("components");

  if (!showProducts && !showComponents && !canCreate) return null;

  return (
    <nav className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 z-40 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 items-center gap-2 rounded-full bg-gray-900 px-2.5 py-2.5 shadow-lg sm:bottom-6 sm:gap-2.5 sm:px-3.5 sm:py-3">
      {showProducts && (
        <button
          type="button"
          onClick={() => onTabChange("products")}
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition sm:h-14 sm:w-14 ${
            tab === "products"
              ? "gradient-accent text-white"
              : "text-gray-400 hover:text-white"
          }`}
          aria-label="Готовая продукция"
          aria-current={tab === "products" ? "page" : undefined}
        >
          <Package className="h-6 w-6 sm:h-7 sm:w-7" strokeWidth={2} />
        </button>
      )}

      {showComponents && (
        <button
          type="button"
          onClick={() => onTabChange("components")}
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition sm:h-14 sm:w-14 ${
            tab === "components"
              ? "gradient-accent text-white"
              : "text-gray-400 hover:text-white"
          }`}
          aria-label="Комплектующие"
          aria-current={tab === "components" ? "page" : undefined}
        >
          <Bolt className="h-6 w-6 sm:h-7 sm:w-7" strokeWidth={2} />
        </button>
      )}

      {canCreate && (
        <button
          type="button"
          onClick={onCreate}
          className="ml-0.5 flex h-14 w-14 shrink-0 items-center justify-center rounded-full gradient-accent text-white shadow-lg transition hover:scale-105 sm:h-16 sm:w-16"
          aria-label="Создать"
        >
          <Plus className="h-7 w-7 sm:h-8 sm:w-8" strokeWidth={2.5} />
        </button>
      )}
    </nav>
  );
}
