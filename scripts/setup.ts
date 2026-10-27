import "dotenv/config";
import { randomUUID } from "node:crypto";
import { pool, migrate } from "../server/db.js";
import { hash } from "../server/security.js";
await migrate();
if (process.argv.includes("--admin")) {
  const email = process.env.ADMIN_EMAIL?.toLowerCase(),
    password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 14)
    throw new Error(
      "Set ADMIN_EMAIL and ADMIN_PASSWORD (14+ characters) for initial admin setup",
    );
  await pool.query(
    "INSERT INTO admins(id,email,password_hash) VALUES($1,$2,$3) ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash",
    [randomUUID(), email, await hash(password)],
  );
  await pool.query(
    "DELETE FROM sessions WHERE admin_id IN (SELECT id FROM admins WHERE email=$1)",
    [email],
  );
  console.log(
    "Administrator ready. Remove ADMIN_PASSWORD from the environment.",
  );
}
await pool.end();
