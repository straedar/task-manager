import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/requireRoot.js";
import { getAllUsers } from "../db/queries/users.js";

const router = Router();

router.use(requireAuth, requirePermission("app.structure"));

router.get("/users", (_req, res) => {
  const users = getAllUsers().sort((a, b) => {
    const an = `${a.last_name} ${a.first_name} ${a.nickname}`.trim().toLowerCase();
    const bn = `${b.last_name} ${b.first_name} ${b.nickname}`.trim().toLowerCase();
    return an.localeCompare(bn, "ru");
  });
  res.json({ users });
});

export default router;
