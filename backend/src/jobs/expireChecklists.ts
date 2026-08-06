import { expireDueChecklists } from "../db/queries/checklists.js";

const INTERVAL_MS = 30_000;

export function startChecklistExpiryJob() {
  const tick = () => {
    try {
      const closed = expireDueChecklists();
      if (closed > 0) {
        console.log(`[checklists] auto-completed ${closed} checklist(s)`);
      }
    } catch (err) {
      console.error("[checklists] expire job failed", err);
    }
  };

  tick();
  return setInterval(tick, INTERVAL_MS);
}
