import { Router } from "express";
import { HUB_APPS } from "../permissions/catalog.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

/** Hub mini-apps derived from the feature registry. */
router.get("/apps", requireAuth, (_req, res) => {
  res.json({ apps: HUB_APPS });
});

export default router;
