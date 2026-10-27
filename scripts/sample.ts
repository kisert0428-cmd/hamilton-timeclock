import "dotenv/config";
import { randomUUID } from "node:crypto";
import { pool, migrate } from "../server/db.js";
import { hash, lookup, secret } from "../server/security.js";
if (
  process.env.NODE_ENV === "production" ||
  process.env.ALLOW_DEV_SEED !== "yes"
)
  throw new Error(
    "Sample data requires ALLOW_DEV_SEED=yes and is forbidden in production",
  );
await migrate();
for (const [employee_id, name, pin] of [
  ["DEV-001", "Alex Morgan", "1234"],
  ["DEV-002", "Jordan Taylor", "5678"],
]) {
  await pool.query(
    "INSERT INTO employees(id,employee_id,name,location,pin_hash,pin_lookup) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(employee_id) DO NOTHING",
    [
      randomUUID(),
      employee_id,
      name,
      "Development Warehouse",
      await hash(pin + secret()),
      lookup(pin),
    ],
  );
}
console.log(
  "Development employees ready: Alex Morgan / 1234; Jordan Taylor / 5678.",
);
await pool.end();
