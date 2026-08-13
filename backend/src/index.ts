import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { getDb } from "./db/index.js";
import { seedDatabase } from "./db/seed.js";
import authRoutes from "./routes/auth.js";
import rolesRoutes from "./routes/roles.js";
import hubRoutes from "./routes/hub.js";
import referenceRoutes from "./routes/reference.js";
import newsRoutes from "./routes/news.js";
import feedbackRoutes from "./routes/feedback.js";
import profileRoutes from "./routes/profile.js";
import structureRoutes from "./routes/structure.js";
import taskRoutes from "./routes/tasks.js";
import ideaRoutes from "./routes/ideas.js";
import checklistRoutes from "./routes/checklists.js";
import presetRoutes from "./routes/presets.js";
import pushRoutes from "./routes/push.js";
import notifPrefsRoutes from "./routes/notifPrefs.js";
import uploadsRoutes from "./uploads/routes.js";
import { startPushJobs } from "./jobs/pushNotifications.js";
import { isPushConfigured } from "./services/push.js";
import { ensureUploadDirs } from "./uploads/store.js";

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";

/** Allow localhost + LAN origins (phone on same Wi‑Fi). */
function corsOrigin(
  origin: string | undefined,
  cb: (err: Error | null, allow?: boolean) => void
) {
  if (!origin) {
    cb(null, true);
    return;
  }
  if (origin === FRONTEND_URL) {
    cb(null, true);
    return;
  }
  try {
    const url = new URL(origin);
    const host = url.hostname;
    const local =
      host === "localhost" ||
      host === "127.0.0.1" ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host);
    cb(null, local);
  } catch {
    cb(null, false);
  }
}

getDb();
ensureUploadDirs();
seedDatabase();
startPushJobs();

if (!isPushConfigured()) {
  console.warn("[push] VAPID keys missing — push notifications disabled");
}

app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

app.use("/api/auth", authRoutes);
app.use("/api/roles", rolesRoutes);
app.use("/api/hub", hubRoutes);
app.use("/api/reference", referenceRoutes);
app.use("/api/news", newsRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/structure", structureRoutes);
app.use("/api/uploads", uploadsRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/ideas", ideaRoutes);
app.use("/api/checklists", checklistRoutes);
app.use("/api/presets", presetRoutes);
app.use("/api/push", pushRoutes);
app.use("/api/notification-prefs", notifPrefsRoutes);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend running on http://0.0.0.0:${PORT}`);
});
