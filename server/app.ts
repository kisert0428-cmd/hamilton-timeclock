import { mountAdminSetup } from "./admin-setup.js";
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import ExcelJS from "exceljs";
import { DateTime } from "luxon";
import { pool, transaction } from "./db.js";
import {
  secret,
  lookup,
  digest,
  hash,
  verify,
  token,
  newPin,
  rate,
  locationCheck,
} from "./security.js";
import { analyze, instant, validSequence, weekBounds, ZONE } from "./time.js";
import { mountLocation, trustedKiosk } from "./location.js";
const fail = (message: string, status = 400) =>
  Object.assign(new Error(message), { status });
const punchType = z.enum(["in", "lunch_out", "lunch_in", "out"]);
const uuid = z.string().uuid();
export function createApp(db: any = pool, tx: any = transaction) {
  secret();
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 0));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "script-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "img-src": ["'self'", "data:"],
        },
      },
    }),
  );
  app.use(express.json({ limit: "12kb" }));
  app.use(cookieParser());
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  const secure = process.env.NODE_ENV === "production";
  const cookie = {
    httpOnly: true,
    secure,
    sameSite: "strict" as const,
    path: "/",
  };
  app.use("/api", (req, res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.get("origin") !== process.env.APP_ORIGIN
    )
      return res.status(403).json({ error: "Request origin rejected" });
    next();
  });
  const admin = async (req: any, res: any, next: any) => {
    try {
      const s = await db.query(
        "SELECT a.id,a.email FROM sessions s JOIN admins a ON a.id=s.admin_id WHERE s.token_hash=$1 AND s.expires_at>clock_timestamp()",
        [digest(req.cookies.session || "")],
      );
      if (!s.rows[0])
        return res
          .status(401)
          .json({ error: "Administrator sign-in required" });
      req.admin = s.rows[0];
      next();
    } catch (e) {
      next(e);
    }
  };
  app.get("/api/config", async (req, res) => {
    const s = (
      await db.query(
        "SELECT workweek_start,true AS geofence_enabled FROM settings WHERE id=1",
      )
    ).rows[0];
    res.json({
      ...s,
      kiosk: !!(await trustedKiosk(db, req)),
      timezone: ZONE,
      serverTime: new Date().toISOString(),
    });
  });
  app.post("/api/login", async (req, res) => {
    await rate(db, "login:" + digest(req.ip || ""), 10);
    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(1).max(200),
      })
      .parse(req.body);
    const a = (
      await db.query("SELECT * FROM admins WHERE email=$1", [
        body.email.toLowerCase(),
      ])
    ).rows[0];
    if (!a || !(await verify(a.password_hash, body.password)))
      throw fail("Email or password is incorrect", 401);
    const t = token();
    await db.query("DELETE FROM sessions WHERE expires_at<clock_timestamp()");
    await db.query(
      "INSERT INTO sessions(token_hash,admin_id,expires_at) VALUES($1,$2,clock_timestamp()+interval '8 hours')",
      [digest(t), a.id],
    );
    res
      .cookie("session", t, { ...cookie, maxAge: 8 * 3600000 })
      .json({ email: a.email });
  });
  app.get("/api/me", admin, (req: any, res) => res.json(req.admin));
  app.post("/api/logout", admin, async (req, res) => {
    await db.query("DELETE FROM sessions WHERE token_hash=$1", [
      digest(req.cookies.session),
    ]);
    res.clearCookie("session", cookie).json({ ok: true });
  });
  mountAdminSetup(app, db, tx);
  mountLocation(app, db, tx, admin, cookie);
  app.get("/api/employees", admin, async (_req, res) =>
    res.json(
      (
        await db.query(
          "SELECT id,employee_id,name,location,active FROM employees ORDER BY name",
        )
      ).rows,
    ),
  );
  app.post("/api/employees", admin, async (req, res) => {
    const b = z
      .object({
        employee_id: z.string().trim().min(1).max(30),
        name: z.string().trim().min(1).max(100),
        location: z.string().trim().min(1).max(100),
      })
      .parse(req.body);
    const result = await tx(async (c: any) => {
      await c.query("SELECT pg_advisory_xact_lock(12001)");
      const p = await newPin(c);
      const id = randomUUID();
      await c.query(
        "INSERT INTO employees(id,employee_id,name,location,pin_hash,pin_lookup) VALUES($1,$2,$3,$4,$5,$6)",
        [id, b.employee_id, b.name, b.location, p.pin_hash, p.pin_lookup],
      );
      return { id, pin: p.pin };
    });
    res.status(201).json(result);
  });
  app.patch("/api/employees/:id", admin, async (req, res) => {
    const id = uuid.parse(req.params.id);
    const b = z
      .object({
        active: z.boolean(),
        name: z.string().trim().min(1).max(100),
        location: z.string().trim().min(1).max(100),
      })
      .parse(req.body);
    const r = await db.query(
      "UPDATE employees SET active=$2,name=$3,location=$4 WHERE id=$1 RETURNING id",
      [id, b.active, b.name, b.location],
    );
    if (!r.rowCount) throw fail("Employee not found", 404);
    res.json({ ok: true });
  });
  app.post("/api/employees/:id/pin", admin, async (req, res) => {
    const id = uuid.parse(req.params.id);
    const p = await tx(async (c: any) => {
      await c.query("SELECT pg_advisory_xact_lock(12001)");
      const p = await newPin(c);
      if (
        !(
          await c.query(
            "UPDATE employees SET pin_hash=$2,pin_lookup=$3 WHERE id=$1 RETURNING id",
            [id, p.pin_hash, p.pin_lookup],
          )
        ).rows.length
      )
        throw fail("Employee not found", 404);
      return p.pin;
    });
    res.json({ pin: p });
  });
  async function report(date: string) {
    const settings = (await db.query("SELECT * FROM settings WHERE id=1"))
      .rows[0];
    const { from, to } = weekBounds(date, settings.workweek_start);
    const employees = (
      await db.query(
        "SELECT id,employee_id,name,location,active FROM employees ORDER BY name",
      )
    ).rows;
    const punches = (
      await db.query("SELECT * FROM effective_punches ORDER BY at,id")
    ).rows;
    return {
      settings,
      from: from.toISODate(),
      to: to.minus({ days: 1 }).toISODate(),
      employees: employees.map((e: any) => ({
        ...e,
        ...analyze(
          punches.filter((p: any) => p.employee_id === e.id),
          date,
          settings.workweek_start,
        ),
      })),
    };
  }
  const dateParam = (req: any) =>
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .parse(req.query.week || DateTime.now().setZone(ZONE).toISODate());
  app.get("/api/report", admin, async (req, res) =>
    res.json(await report(dateParam(req))),
  );
  app.get("/api/punches/:id", admin, async (req, res) => {
    const id = uuid.parse(req.params.id);
    res.json({
      punches: (
        await db.query(
          "SELECT * FROM effective_punches WHERE employee_id=$1 ORDER BY at DESC",
          [id],
        )
      ).rows,
      audit: (
        await db.query(
          "SELECT c.*,a.email FROM corrections c JOIN admins a ON a.id=c.admin_id JOIN punches p ON p.id=c.punch_id WHERE p.employee_id=$1 ORDER BY c.at DESC",
          [id],
        )
      ).rows,
    });
  });
  app.post("/api/corrections", admin, async (req: any, res) => {
    const b = z
      .object({
        employee_id: uuid,
        punch_id: uuid.optional(),
        type: punchType,
        at: z.string().datetime({ offset: true }),
        reason: z.string().trim().min(5).max(1000),
      })
      .parse(req.body);
    if (new Date(b.at).getTime() > Date.now())
      throw fail("Punches cannot be in the future");
    await tx(async (c: any) => {
      const employee = (
        await c.query("SELECT id FROM employees WHERE id=$1 FOR UPDATE", [
          b.employee_id,
        ])
      ).rows[0];
      if (!employee) throw fail("Employee not found", 404);
      const punches = (
        await c.query(
          "SELECT * FROM effective_punches WHERE employee_id=$1 ORDER BY at,id",
          [b.employee_id],
        )
      ).rows;
      const old = punches.find((p: any) => p.id === b.punch_id);
      if (b.punch_id && !old) throw fail("Punch not found", 404);
      const updated = {
        id: b.punch_id || randomUUID(),
        employee_id: b.employee_id,
        type: b.type,
        at: b.at,
      };
      const sequence = [
        ...punches.filter((p: any) => p.id !== b.punch_id),
        updated,
      ].sort((a, b) => instant(a.at) - instant(b.at));
      if (
        sequence.some(
          (p, i) => i > 0 && instant(p.at) === instant(sequence[i - 1].at),
        )
      )
        throw fail("Punch timestamps must be distinct");
      if (!validSequence(sequence))
        throw fail(
          "Correction would create an invalid punch sequence. Add missing punches in chronological order.",
          409,
        );
      if (old)
        await c.query(
          "INSERT INTO corrections(id,punch_id,original_value,corrected_value,admin_id,reason) VALUES($1,$2,$3,$4,$5,$6)",
          [
            randomUUID(),
            old.id,
            JSON.stringify({ type: old.type, at: old.at }),
            JSON.stringify({ type: b.type, at: b.at }),
            req.admin.id,
            b.reason,
          ],
        );
      else {
        await c.query(
          "INSERT INTO punches(id,employee_id,type,at,created_by,reason) VALUES($1,$2,$3,$4,$5,$6)",
          [updated.id, b.employee_id, b.type, b.at, req.admin.id, b.reason],
        );
        await c.query(
          "INSERT INTO corrections(id,punch_id,original_value,corrected_value,admin_id,reason) VALUES($1,$2,$3,$4,$5,$6)",
          [
            randomUUID(),
            updated.id,
            JSON.stringify({ type: null, at: null }),
            JSON.stringify({ type: b.type, at: b.at }),
            req.admin.id,
            b.reason,
          ],
        );
      }
    });
    res.json({ ok: true });
  });
  app.put("/api/settings", admin, async (req, res) => {
    const b = z
      .object({
        workweek_start: z.number().int().min(1).max(7),
        long_shift_hours: z.number().int().min(8).max(48),
        geofence_enabled: z.literal(true).default(true),
        latitude: z.number().min(-90).max(90).nullable(),
        longitude: z.number().min(-180).max(180).nullable(),
        radius_m: z.number().min(3.048).max(10000),
      })
      .parse(req.body);
    if (b.geofence_enabled && (b.latitude === null || b.longitude === null))
      throw fail("Warehouse coordinates are required");
    await db.query(
      "UPDATE settings SET workweek_start=$1,long_shift_hours=$2,geofence_enabled=$3,latitude=$4,longitude=$5,radius_m=$6 WHERE id=1",
      [
        b.workweek_start,
        b.long_shift_hours,
        b.geofence_enabled,
        b.latitude,
        b.longitude,
        b.radius_m,
      ],
    );
    res.json({ ok: true });
  });
  app.get("/api/export", admin, async (req, res) => {
    const r = await report(dateParam(req));
    const book = new ExcelJS.Workbook();
    book.creator = "Hamilton Drywall Products";
    book.created = new Date();
    const detail = book.addWorksheet("Daily detail");
    detail.columns = [
      ["Employee ID", 18],
      ["Employee Name", 25],
      ["Date", 16],
      ["Clock In", 24],
      ["Lunch Out", 24],
      ["Lunch In", 24],
      ["Clock Out", 24],
      ["Daily Hours", 16],
      ["Weekly Regular Hours", 22],
      ["Weekly Overtime Hours", 24],
      ["Weekly Total Hours", 22],
      ["Unpaid Lunch Hours", 22],
      ["Review Notes", 50],
    ].map(([header, width]) => ({
      header: String(header),
      width: Number(width),
    }));
    const summary = book.addWorksheet("Weekly summary");
    summary.columns = [
      "Employee ID",
      "Employee Name",
      "Week Starting",
      "Regular Hours",
      "Overtime Hours",
      "Total Hours",
      "Unpaid Lunch Hours",
      "Review Notes",
    ].map((header) => ({ header, width: header === "Review Notes" ? 55 : 24 }));
    const fmt = (p: any) =>
      p
        ? DateTime.fromJSDate(new Date(p.at), { zone: ZONE }).toFormat(
            "yyyy-MM-dd HH:mm:ss ZZ",
          )
        : "";
    for (const e of r.employees) {
      for (const day of e.days) {
        const shifts = e.shifts.filter((s: any) =>
          s.punches.some(
            (p: any) =>
              DateTime.fromJSDate(new Date(p.at), {
                zone: ZONE,
              }).toISODate() === day.date,
          ),
        );
        detail.addRow([
          e.employee_id,
          e.name,
          day.date,
          shifts
            .map((s: any) => fmt(s.punches.find((p: any) => p.type === "in")))
            .join("\n"),
          shifts
            .flatMap((s: any) =>
              s.punches.filter((p: any) => p.type === "lunch_out").map(fmt),
            )
            .join("\n"),
          shifts
            .flatMap((s: any) =>
              s.punches.filter((p: any) => p.type === "lunch_in").map(fmt),
            )
            .join("\n"),
          shifts
            .map((s: any) => fmt(s.punches.find((p: any) => p.type === "out")))
            .join("\n"),
          day.seconds / 3600,
          e.regular,
          e.overtime,
          e.total,
          day.lunch / 3600,
          e.flags.join("; "),
        ]);
      }
      summary.addRow([
        e.employee_id,
        e.name,
        r.from,
        e.regular,
        e.overtime,
        e.total,
        e.lunch,
        e.flags.join("; "),
      ]);
    }
    const audit = book.addWorksheet("Punch corrections");
    audit.columns = [
      "Employee ID",
      "Employee Name",
      "Original Value",
      "Corrected Value",
      "Administrator",
      "Reason",
      "Correction UTC",
    ].map((header) => ({ header, width: 32 }));
    const rows = (
      await db.query(
        "SELECT c.*,e.employee_id,e.name,a.email FROM corrections c JOIN punches p ON p.id=c.punch_id JOIN employees e ON e.id=p.employee_id JOIN admins a ON a.id=c.admin_id ORDER BY c.at",
      )
    ).rows;
    for (const c of rows)
      audit.addRow([
        c.employee_id,
        c.name,
        JSON.stringify(c.original_value),
        JSON.stringify(c.corrected_value),
        c.email,
        c.reason,
        new Date(c.at).toISOString(),
      ]);
    const locations = book.addWorksheet("Location verification");
    locations.columns = [
      "Employee ID",
      "Employee Name",
      "Punch UTC",
      "Punch Type",
      "Location Status",
      "Approximate Distance (m)",
      "GPS Accuracy (m)",
      "Review Decision",
    ].map((header) => ({ header, width: 30 }));
    const week = weekBounds(dateParam(req), r.settings.workweek_start);
    const locationRows = (
      await db.query(
        "SELECT p.*,e.employee_id AS staff_id,e.name FROM effective_punches p JOIN employees e ON e.id=p.employee_id WHERE p.at >= $1 AND p.at < $2 ORDER BY p.at",
        [week.from.toISO(), week.to.toISO()],
      )
    ).rows;
    const statuses: Record<string, string> = {
      verified: "Verified at Warehouse",
      trusted_kiosk: "Trusted Warehouse Kiosk",
      outside: "Outside Geofence — Review Required",
      unavailable: "GPS Unavailable — Review Required",
      unverified: "GPS Unavailable — Review Required",
      poor_accuracy: "Poor GPS Accuracy — Review Required",
    };
    for (const p of locationRows)
      locations.addRow([
        p.staff_id,
        p.name,
        new Date(p.at).toISOString(),
        p.type,
        statuses[p.location_check] || p.location_check,
        p.approximate_distance_m,
        p.accuracy_m,
        p.review_decision || "",
      ]);
    const decisions = book.addWorksheet("Location review audit");
    decisions.columns = [
      "Employee Name",
      "Punch ID",
      "Decision",
      "Previous Decision",
      "Administrator",
      "Reason",
      "Review UTC",
    ].map((header) => ({ header, width: 30 }));
    for (const review of (
      await db.query(
        "SELECT r.*,a.email,e.name FROM punch_reviews r JOIN admins a ON a.id=r.admin_id JOIN punches p ON p.id=r.punch_id JOIN employees e ON e.id=p.employee_id ORDER BY r.at",
      )
    ).rows)
      decisions.addRow([
        review.name,
        review.punch_id,
        review.decision,
        review.previous_decision || "Pending",
        review.email,
        review.reason,
        new Date(review.at).toISOString(),
      ]);
    for (const sh of book.worksheets) {
      sh.views = [{ state: "frozen", ySplit: 1 }];
      sh.autoFilter = { from: "A1", to: { row: 1, column: sh.columnCount } };
      sh.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sh.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF173A32" },
      };
      sh.getRow(1).height = 30;
      sh.eachRow((row, i) => {
        if (i > 1) {
          row.alignment = { vertical: "top", wrapText: true };
          row.eachCell((cell) => {
            if (typeof cell.value === "number") cell.numFmt = "0.0000";
          });
          if (i % 2 === 0)
            row.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFF0F5F2" },
            };
        }
      });
    }
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="Hamilton-Payroll-${r.from}.xlsx"`,
    );
    await book.xlsx.write(res);
    res.end();
  });
  app.get("/api/health", async (_req, res) => {
    await db.query("SELECT 1");
    res.json({ ok: true });
  });
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
  app.use((err: any, _req: any, res: any, _next: any) => {
    if (err.code === "23505")
      return res
        .status(409)
        .json({ error: "Employee ID or PIN already exists. Please retry." });
    if (err instanceof z.ZodError)
      return res.status(400).json({
        error: "Please check all fields.",
        details: err.issues.map((i) => i.path.join(".") + ": " + i.message),
      });
    if (!err.status) console.error("Request failure:", err.code || err.name);
    res.status(err.status || 500).json({
      error: err.status
        ? err.message
        : "The request could not be saved. Please try again or contact management.",
    });
  });
  return app;
}
