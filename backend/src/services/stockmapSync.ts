import type { AuthRequest } from "../middleware/auth.js";

export type CatalogNameSyncItem = {
  kind: "component" | "product";
  refId: number;
  nameSnapshot?: string;
  typeSnapshot?: string;
};

/** Best-effort push of renamed catalog labels into stockmap shelf contents. */
export function syncStockmapCatalogNames(
  req: AuthRequest,
  updates: CatalogNameSyncItem[]
): void {
  if (updates.length === 0) return;
  const base =
    process.env.STOCKMAP_INTERNAL_URL?.replace(/\/$/, "") ||
    "http://127.0.0.1:3003";
  const cookie = req.headers.cookie;
  void fetch(`${base}/api/catalog/sync-names`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({ updates }),
  }).catch(() => {
    /* stockmap may be down — non-fatal */
  });
}
