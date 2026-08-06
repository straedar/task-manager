import "dotenv/config";
import { getDb } from "./index.js";
import { getUserByNickname } from "./queries/users.js";
import { runTransaction } from "./index.js";

const adminNickname = process.env.SEED_ADMIN_NICKNAME ?? "admin";
getDb();
const admin = getUserByNickname(adminNickname);

if (admin) {
  runTransaction(() => {
    const db = getDb();
    db.prepare("DELETE FROM task_assignees").run();
    db.prepare("DELETE FROM tasks").run();
    db.prepare("DELETE FROM users WHERE id != ?").run(admin.id);
  });
  console.log(`Removed all users except "${adminNickname}".`);
}
