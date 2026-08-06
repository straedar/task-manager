import bcrypt from "bcryptjs";
import { getDb, runTransaction } from "./index.js";
import { seedDefaultRoles } from "./queries/roles.js";

export function seedDatabase() {
  seedDefaultRoles();

  const db = getDb();
  const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get() as {
    count: number;
  };

  if (userCount.count > 0) {
    console.log("Database already seeded, skipping users.");
    return;
  }

  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "admin123";
  const adminNickname = process.env.SEED_ADMIN_NICKNAME ?? "admin";
  const passwordHash = bcrypt.hashSync(adminPassword, 10);

  runTransaction(() => {
    db.prepare(
      "INSERT INTO users (nickname, password_hash, parent_id, role_id) VALUES (?, ?, NULL, NULL)"
    ).run(adminNickname, passwordHash);
  });

  console.log(`Seeded database. Root user: ${adminNickname} / ${adminPassword}`);
}
