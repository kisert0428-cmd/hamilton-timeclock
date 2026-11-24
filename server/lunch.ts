import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DateTime } from "luxon";
import { analyze, ZONE } from "./time.js";
export async function lunchContext(db: any) {
  const policies = (
    await db.query(
      "SELECT p.*,a.email FROM lunch_policies p LEFT JOIN admins a ON a.id=p.admin_id ORDER BY p.effective_at,p.id",
    )
  ).rows;
  const exceptions = (
    await db.query(
      "SELECT l.*,a.email FROM lunch_exceptions l JOIN admins a ON a.id=l.admin_id ORDER BY l.at,l.id",
    )
  ).rows;
  return { policies, exceptions };
}
export function mountLunch(app: any, db: any, tx: any, admin: any) {
  app.get("/api/lunch-policy", admin, async (_req: any, res: any) =>
    res.json({
      policies: (
        await db.query(
          "SELECT p.*,a.email FROM lunch_policies p LEFT JOIN admins a ON a.id=p.admin_id ORDER BY effective_at DESC",
        )
      ).rows,
    }),
  );
  app.put("/api/lunch-policy", admin, async (req: any, res: any) => {
    const b = z
      .object({
        enabled: z.boolean(),
        reason: z.string().trim().min(5).max(1000),
      })
      .parse(req.body);
    await tx(async (c: any) => {
      await c.query("SELECT pg_advisory_xact_lock(12004)");
      const old = (
        await c.query(
          "SELECT enabled FROM lunch_policies ORDER BY effective_at DESC,id DESC LIMIT 1",
        )
      ).rows[0];
      if (old?.enabled === b.enabled) return;
      await c.query(
        "INSERT INTO lunch_policies(id,enabled,admin_id,reason) VALUES($1,$2,$3,$4)",
        [randomUUID(), b.enabled, req.admin.id, b.reason],
      );
    });
    res.json({ ok: true });
  });
  app.post("/api/lunch-exceptions", admin, async (req: any, res: any) => {
    const b = z
      .object({
        clock_in_id: z.string().uuid(),
        waived: z.boolean(),
        reason: z.string().trim().min(5).max(1000),
      })
      .parse(req.body);
    await tx(async (c: any) => {
      const p = (
        await c.query("SELECT employee_id FROM punches WHERE id=$1", [
          b.clock_in_id,
        ])
      ).rows[0];
      if (!p)
        throw Object.assign(new Error("Shift not found"), { status: 404 });
      await c.query("SELECT id FROM employees WHERE id=$1 FOR UPDATE", [
        p.employee_id,
      ]);
      const punches = (
        await c.query(
          "SELECT * FROM effective_punches WHERE employee_id=$1 ORDER BY at,id",
          [p.employee_id],
        )
      ).rows;
      const ctx = await lunchContext(c);
      const shift = analyze(
        punches,
        DateTime.now().setZone(ZONE).toISODate()!,
        1,
        Date.now(),
        ctx.policies,
        ctx.exceptions,
      ).shifts.find((s) => s.punches[0]?.id === b.clock_in_id);
      if (!shift || shift.open || !shift.scheduledAutomaticLunchSeconds)
        throw Object.assign(
          new Error(
            "This completed shift has no automatic lunch adjustment to change",
          ),
          { status: 400 },
        );
      await c.query(
        "INSERT INTO lunch_exceptions(id,clock_in_id,waived,admin_id,reason) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), b.clock_in_id, b.waived, req.admin.id, b.reason],
      );
    });
    res.json({ ok: true });
  });
}
