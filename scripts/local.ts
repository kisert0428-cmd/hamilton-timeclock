import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
if (process.env.NODE_ENV === "production")
  throw new Error("Local mode is for development only");
mkdirSync(".local", { recursive: true });
if (!existsSync(".local/secret"))
  writeFileSync(".local/secret", randomBytes(32).toString("hex"), {
    mode: 0o600,
  });
process.env.APP_SECRET = readFileSync(".local/secret", "utf8");
process.env.APP_ORIGIN = "http://localhost:3000";
process.env.DEV_DATABASE_PATH = ".local/database";
const { migrate } = await import("../server/db.js");
await migrate();
console.log(
  "Development database ready. No employees or administrators are automatically added.",
);
await import("../server/index.js");
