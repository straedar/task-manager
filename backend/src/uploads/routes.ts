import { Router, static as expressStatic } from "express";
import { ensureUploadDirs, uploadsRoot } from "./store.js";

ensureUploadDirs();

const router = Router();

/** Public files: /api/uploads/avatars/… and /api/uploads/misc/… */
router.use(
  "/",
  expressStatic(uploadsRoot(), {
    maxAge: "7d",
    fallthrough: false,
  })
);

export default router;
