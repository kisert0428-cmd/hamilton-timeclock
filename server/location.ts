import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  digest,
  token,
  lookup,
  secret,
  verify,
  rate,
  locationCheck,
} from "./security.js";
import { validSequence, instant } from "./time.js";
const fail = (message: string, status = 400) =>
  Object.assign(new Error(message), { status });
const coordsSchema = z
  .object({
    latitude: z.number().finite(),
    longitude: z.number().finite(),
    accuracy: z.number().nonnegative().finite(),
    timestamp: z.number().finite(),
  })
  .nullable()
  .optional();
export const reviewStatuses = [
  "outside",
  "unavailable",
  "poor_accuracy",
  "unverified",
];
export async function trustedKiosk(db: any, req: any) {
  return (
    (
      await db.query(
        "SELECT id,name FROM trusted_kiosks WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()",
        [digest(req.cookies.kiosk || "")],
      )
    ).rows[0] || null
  );
}
export function mountLocation(
  app: any,
  db: any,
  tx: any,
  admin: any,
  cookie: any,
) {
  app.get("/api/kiosks", admin, async (_req: any, res: any) =>
    res.json(
      (
        await db.query(
          "SELECT k.id,k.name,k.registered_at,k.expires_at,k.revoked_at,a.email FROM trusted_kiosks k JOIN admins a ON a.id=k.registered_by ORDER BY k.registered_at DESC",
        )
      ).rows,
    ),
  );
  app.post("/api/kiosk", admin, async (req: any, res: any) => {
    const b = z
      .object({
        enabled: z.boolean(),
        name: z.string().trim().min(1).max(100).optional(),
      })
      .parse(req.body);
    if (b.enabled) {
      const t = token(),
        id = randomUUID();
      await tx(async (c: any) => {
        await c.query(
          "INSERT INTO trusted_kiosks(id,name,token_hash,registered_by,expires_at) VALUES($1,$2,$3,$4,clock_timestamp()+interval '30 days')",
          [id, b.name || "Warehouse device", digest(t), req.admin.id],
        );
        await c.query(
          "INSERT INTO kiosk_audit(id,kiosk_id,admin_id,action) VALUES($1,$2,$3,$4)",
          [randomUUID(), id, req.admin.id, "registered"],
        );
        const old = await trustedKiosk(c, req);
        if (old) {
          await c.query(
            "UPDATE trusted_kiosks SET revoked_at=clock_timestamp() WHERE id=$1",
            [old.id],
          );
          await c.query(
            "INSERT INTO kiosk_audit(id,kiosk_id,admin_id,action) VALUES($1,$2,$3,$4)",
            [randomUUID(), old.id, req.admin.id, "replaced"],
          );
        }
        await c.query("DELETE FROM sessions WHERE token_hash=$1", [
          digest(req.cookies.session || ""),
        ]);
      });
      res.cookie("kiosk", t, { ...cookie, maxAge: 30 * 86400000 });
      res.clearCookie("session", cookie);
    } else {
      const old = await trustedKiosk(db, req);
      if (old) await revoke(old.id, req.admin.id);
      res.clearCookie("kiosk", cookie);
    }
    res.json({ ok: true });
  });
  async function revoke(id: string, adminID: string) {
    await tx(async (c: any) => {
      const k = (
        await c.query(
          "UPDATE trusted_kiosks SET revoked_at=clock_timestamp() WHERE id=$1 AND revoked_at IS NULL RETURNING id",
          [id],
        )
      ).rows[0];
      if (!k) throw fail("Active device not found", 404);
      await c.query(
        "INSERT INTO kiosk_audit(id,kiosk_id,admin_id,action) VALUES($1,$2,$3,$4)",
        [randomUUID(), id, adminID, "revoked"],
      );
    });
  }
  app.delete("/api/kiosks/:id", admin, async (req: any, res: any) => {
    await revoke(z.string().uuid().parse(req.params.id), req.admin.id);
    res.json({ ok: true });
  });
  async function finish(c: any, a: any, e: any) {
    if (a.punch_id) {
      const p = (
        await c.query("SELECT * FROM punches WHERE id=$1", [a.punch_id])
      ).rows[0];
      return response(e, p);
    }
    const ps = (
      await c.query(
        "SELECT * FROM effective_punches WHERE employee_id=$1 ORDER BY at,id",
        [e.id],
      )
    ).rows;
    const p = { id: randomUUID(), employee_id: e.id, type: a.type, at: a.at };
    if (
      !validSequence([...ps, p].sort((a, b) => instant(a.at) - instant(b.at)))
    )
      throw fail(
        "This punch conflicts with your recorded status. The attempt is retained; contact your manager to correct missing punches.",
        409,
      );
    const row = (
      await c.query(
        "INSERT INTO punches(id,employee_id,type,at,location_check,approximate_distance_m,accuracy_m,kiosk_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [
          p.id,
          e.id,
          p.type,
          a.at,
          a.status,
          a.approximate_distance_m,
          a.accuracy_m,
          a.kiosk_id,
        ],
      )
    ).rows[0];
    await c.query("UPDATE location_attempts SET punch_id=$2 WHERE id=$1", [
      a.id,
      p.id,
    ]);
    return response(e, row);
  }
  function response(e: any, p: any) {
    const flagged = reviewStatuses.includes(p.location_check);
    return {
      name: e.name,
      type: p.type,
      at: p.at,
      flagged,
      location_status: p.location_check,
      message: flagged
        ? "LOCATION COULD NOT BE VERIFIED. YOUR PUNCH HAS BEEN RECORDED FOR MANAGER REVIEW."
        : "PUNCH SUCCESSFULLY RECORDED",
    };
  }
  const pending = (a: any, t: string) => ({
    pending:
      a.status === "poor_accuracy" && a.retries === 0 ? "retry" : "outside",
    attemptToken: t,
    message:
      a.status === "outside"
        ? "YOU APPEAR TO BE OUTSIDE THE AUTHORIZED WAREHOUSE AREA."
        : "GPS accuracy is poor. Requesting a fresh reading before deciding.",
  });
  app.post("/api/punch", async (req: any, res: any) => {
    await rate(db, "ip:" + digest(req.ip || ""), 100);
    const b = z
      .object({
        pin: z.string().regex(/^\d{4}$/),
        type: z.enum(["in", "lunch_out", "lunch_in", "out"]),
        coords: coordsSchema,
      })
      .parse(req.body);
    await rate(db, "pin:" + lookup(b.pin), 20);
    res.json(
      await tx(async (c: any) => {
        const e = (
          await c.query(
            "SELECT * FROM employees WHERE pin_lookup=$1 FOR UPDATE",
            [lookup(b.pin)],
          )
        ).rows[0];
        if (!e || !e.active || !(await verify(e.pin_hash, b.pin + secret())))
          throw fail("PIN not recognized. Please try again.", 401);
        const ps = (
          await c.query(
            "SELECT * FROM effective_punches WHERE employee_id=$1 ORDER BY at,id",
            [e.id],
          )
        ).rows;
        if (!validSequence([...ps, { type: b.type } as any]))
          throw fail(
            "This punch does not match your current status. Ask a manager if a punch is missing.",
            409,
          );
        const s = (await c.query("SELECT * FROM settings WHERE id=1")).rows[0],
          k = await trustedKiosk(c, req),
          v = locationCheck(s, b.coords, !!k),
          t = token();
        const a = (
          await c.query(
            "INSERT INTO location_attempts(id,token_hash,employee_id,type,status,approximate_distance_m,accuracy_m,kiosk_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
            [
              randomUUID(),
              digest(t),
              e.id,
              b.type,
              v.status,
              v.distance,
              v.accuracy,
              k?.id || null,
            ],
          )
        ).rows[0];
        if (["outside", "poor_accuracy"].includes(a.status))
          return pending(a, t);
        return finish(c, a, e);
      }),
    );
  });
  for (const path of ["retry", "provisional"])
    app.post("/api/punch/" + path, async (req: any, res: any) => {
      await rate(db, "location:" + digest(req.ip || ""), 100);
      const b = z
        .object({
          attemptToken: z.string().regex(/^[a-f0-9]{64}$/),
          coords: coordsSchema,
        })
        .parse(req.body);
      res.json(
        await tx(async (c: any) => {
          let a = (
            await c.query(
              "SELECT * FROM location_attempts WHERE token_hash=$1 FOR UPDATE",
              [digest(b.attemptToken)],
            )
          ).rows[0];
          if (!a) throw fail("Unknown punch attempt", 404);
          const e = (
            await c.query("SELECT * FROM employees WHERE id=$1 FOR UPDATE", [
              a.employee_id,
            ])
          ).rows[0];
          if (!e.active)
            throw fail("Employee is inactive. Contact management.", 403);
          if (new Date(a.expires_at).getTime() < Date.now())
            throw fail(
              "This submission window has expired. Check with your manager before trying again; the original attempt is retained.",
              410,
            );
          if (a.punch_id) return finish(c, a, e);
          if (
            (
              await c.query(
                "SELECT id FROM attempt_reviews WHERE attempt_id=$1",
                [a.id],
              )
            ).rows.length
          )
            throw fail(
              "A manager has already reviewed this attempt. Check with management before submitting another punch.",
              409,
            );
          if (path === "retry") {
            if (a.status !== "poor_accuracy" || a.retries !== 0)
              throw fail("A fresh reading has already been requested", 409);
            const s = (await c.query("SELECT * FROM settings WHERE id=1"))
                .rows[0],
              v = locationCheck(s, b.coords, false);
            a = (
              await c.query(
                "UPDATE location_attempts SET status=$2,approximate_distance_m=$3,accuracy_m=$4,retries=retries+1 WHERE id=$1 RETURNING *",
                [a.id, v.status, v.distance, v.accuracy],
              )
            ).rows[0];
            if (a.status === "outside") return pending(a, b.attemptToken);
          } else if (a.status !== "outside")
            throw fail(
              "This attempt is not awaiting provisional submission",
              409,
            );
          return finish(c, a, e);
        }),
      );
    });
  app.get("/api/location-reviews", admin, async (_req: any, res: any) =>
    res.json({
      punches: (
        await db.query(
          "SELECT p.*,e.name,e.employee_id AS staff_id FROM effective_punches p JOIN employees e ON e.id=p.employee_id WHERE p.location_check IN ('outside','unavailable','poor_accuracy','unverified') ORDER BY p.at DESC",
        )
      ).rows,
      attempts: (
        await db.query(
          "SELECT l.id,l.type,l.status,l.at,l.expires_at,l.approximate_distance_m,l.accuracy_m,e.name FROM location_attempts l JOIN employees e ON e.id=l.employee_id WHERE l.punch_id IS NULL AND NOT EXISTS(SELECT 1 FROM attempt_reviews WHERE attempt_id=l.id) ORDER BY l.at DESC",
        )
      ).rows,
      audit: (
        await db.query(
          "SELECT r.*,a.email,e.name FROM punch_reviews r JOIN admins a ON a.id=r.admin_id JOIN punches p ON p.id=r.punch_id JOIN employees e ON e.id=p.employee_id ORDER BY r.at DESC",
        )
      ).rows,
      attemptAudit: (
        await db.query(
          "SELECT r.*,a.email,l.type,l.at AS attempt_at,e.name FROM attempt_reviews r JOIN admins a ON a.id=r.admin_id JOIN location_attempts l ON l.id=r.attempt_id JOIN employees e ON e.id=l.employee_id ORDER BY r.at DESC",
        )
      ).rows,
      kioskAudit: (
        await db.query(
          "SELECT a.*,k.name,u.email FROM kiosk_audit a JOIN trusted_kiosks k ON k.id=a.kiosk_id JOIN admins u ON u.id=a.admin_id ORDER BY a.at DESC",
        )
      ).rows,
    }),
  );
  app.post(
    "/api/location-attempts/:id/review",
    admin,
    async (req: any, res: any) => {
      const id = z.string().uuid().parse(req.params.id),
        b = z
          .object({ reason: z.string().trim().min(5).max(1000) })
          .parse(req.body);
      await tx(async (c: any) => {
        const a = (
          await c.query(
            "SELECT id,punch_id FROM location_attempts WHERE id=$1 FOR UPDATE",
            [id],
          )
        ).rows[0];
        if (!a) throw fail("Attempt not found", 404);
        if (a.punch_id)
          throw fail(
            "This attempt already has a recorded punch; review that punch instead",
            409,
          );
        await c.query(
          "INSERT INTO attempt_reviews(id,attempt_id,admin_id,reason) VALUES($1,$2,$3,$4)",
          [randomUUID(), id, req.admin.id, b.reason],
        );
      });
      res.json({ ok: true });
    },
  );
  app.post("/api/location-reviews/:id", admin, async (req: any, res: any) => {
    const id = z.string().uuid().parse(req.params.id),
      b = z
        .object({
          decision: z.enum(["approved", "follow_up"]),
          reason: z.string().trim().min(5).max(1000),
        })
        .parse(req.body);
    await tx(async (c: any) => {
      const p = (
        await c.query("SELECT id FROM punches WHERE id=$1 FOR UPDATE", [id])
      ).rows[0];
      if (!p) throw fail("Punch not found", 404);
      const previous = (
        await c.query(
          "SELECT review_decision,location_check FROM effective_punches WHERE id=$1",
          [id],
        )
      ).rows[0];
      if (!reviewStatuses.includes(previous.location_check))
        throw fail("This punch does not require location review");
      const n = (
        await c.query(
          "SELECT count(*) AS n FROM corrections WHERE punch_id=$1",
          [id],
        )
      ).rows[0].n;
      await c.query(
        "INSERT INTO punch_reviews(id,punch_id,decision,reason,admin_id,correction_count,previous_decision) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          randomUUID(),
          id,
          b.decision,
          b.reason,
          req.admin.id,
          n,
          previous.review_decision,
        ],
      );
    });
    res.json({ ok: true });
  });
}
