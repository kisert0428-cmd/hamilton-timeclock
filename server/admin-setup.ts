import { randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { digest, hash, rate } from "./security.js";
/** One-time first-administrator activation; the setup key lives only in hosting secrets. */
export function mountAdminSetup(app: any, db: any, tx: any) {
  app.get("/api/setup-status", async (_req: any, res: any) => {
    const existing = (await db.query("SELECT id FROM admins LIMIT 1")).rows
      .length;
    res.json({
      available:
        !existing && (process.env.ADMIN_SETUP_TOKEN?.length || 0) >= 32,
    });
  });
  app.post("/api/setup", async (req: any, res: any) => {
    await rate(db, "setup:" + digest(req.ip || ""), 10);
    const b = z
      .object({
        email: z.string().email().max(200),
        password: z.string().min(14).max(200),
        setupToken: z.string().min(32).max(200),
      })
      .parse(req.body);
    const configured = process.env.ADMIN_SETUP_TOKEN;
    if (!configured || configured.length < 32)
      return res.status(503).json({
        error:
          "Initial setup is not configured. Contact the hosting administrator.",
      });
    if (
      !timingSafeEqual(
        Buffer.from(digest(configured)),
        Buffer.from(digest(b.setupToken)),
      )
    )
      return res.status(403).json({ error: "Setup key is incorrect." });
    const result = await tx(async (c: any) => {
      await c.query("SELECT pg_advisory_xact_lock(12003)");
      if ((await c.query("SELECT id FROM admins LIMIT 1")).rows.length)
        return false;
      await c.query(
        "INSERT INTO admins(id,email,password_hash) VALUES($1,$2,$3)",
        [randomUUID(), b.email.toLowerCase(), await hash(b.password)],
      );
      return true;
    });
    if (!result)
      return res.status(409).json({
        error:
          "An administrator already exists. Sign in or use the documented password recovery process.",
      });
    res.status(201).json({ ok: true });
  });
}
