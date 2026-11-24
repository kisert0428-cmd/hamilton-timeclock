import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import request from "supertest";
import ExcelJS from "exceljs";
import { createApp } from "../server/app.js";
import { hash, lookup, secret } from "../server/security.js";
process.env.APP_SECRET = "lunch-policy-test-only-secret-123456789";
process.env.APP_ORIGIN = "http://localhost:3000";
let pg: PGlite, app: any, manager: any, employee: string, clockIn: string;
const origin = "http://localhost:3000";
const db = {
  query: async (s: string, p: any[] = []) => {
    const r: any = await pg.query(s, p);
    return { ...r, rowCount: r.affectedRows ?? r.rows.length };
  },
};
let tail = Promise.resolve();
const tx = (fn: any) => {
  const r = tail.then(() =>
    pg.transaction((c) =>
      fn({ query: (s: string, p: any[]) => c.query(s, p) }),
    ),
  );
  tail = r.then(
    () => {},
    () => {},
  );
  return r;
};
beforeAll(async () => {
  pg = new PGlite();
  for (const file of [
    "../server/schema.sql",
    "../migrations/002-location.sql",
    "../migrations/003-auto-lunch.sql",
  ])
    await pg.exec(await readFile(new URL(file, import.meta.url), "utf8"));
  await db.query("INSERT INTO admins VALUES($1,$2,$3)", [
    randomUUID(),
    "payroll@example.test",
    await hash("long-test-only-password"),
  ]);
  employee = randomUUID();
  clockIn = randomUUID();
  await db.query(
    "INSERT INTO employees(id,employee_id,name,location,pin_hash,pin_lookup) VALUES($1,$2,$3,$4,$5,$6)",
    [
      employee,
      "LUNCH-001",
      "Lunch Test Employee",
      "Warehouse",
      await hash("1234" + secret()),
      lookup("1234"),
    ],
  );
  await db.query(
    "UPDATE lunch_policies SET effective_at='2026-01-01T00:00:00Z'",
  );
  await db.query(
    "INSERT INTO punches(id,employee_id,type,at) VALUES($1,$2,$3,$4)",
    [clockIn, employee, "in", "2026-11-23T14:00:00Z"],
  );
  await db.query(
    "INSERT INTO punches(id,employee_id,type,at) VALUES($1,$2,$3,$4)",
    [randomUUID(), employee, "out", "2026-11-23T22:00:00Z"],
  );
  app = createApp(db, tx);
  manager = request.agent(app);
  await manager
    .post("/api/login")
    .set("Origin", origin)
    .send({
      email: "payroll@example.test",
      password: "long-test-only-password",
    });
}, 30000);
afterAll(async () => pg.close());
it("protects lunch settings and shift exceptions from unauthorized users", async () => {
  expect((await request(app).get("/api/lunch-policy")).status).toBe(401);
  expect(
    (
      await request(app)
        .put("/api/lunch-policy")
        .set("Origin", origin)
        .send({ enabled: false, reason: "Unauthorized change" })
    ).status,
  ).toBe(401);
  expect(
    (
      await request(app)
        .post("/api/lunch-exceptions")
        .set("Origin", origin)
        .send({
          clock_in_id: clockIn,
          waived: true,
          reason: "Unauthorized waiver",
        })
    ).status,
  ).toBe(401);
  expect(
    (
      await manager
        .put("/api/lunch-policy")
        .send({ enabled: false, reason: "Missing origin test" })
    ).status,
  ).toBe(403);
});
it("reports payable, recorded-lunch and auto-lunch hours separately", async () => {
  const r = await manager.get("/api/report?week=2026-11-23");
  expect(r.status).toBe(200);
  const e = r.body.employees[0];
  expect(e.total).toBe(7.5);
  expect(e.automaticLunch).toBe(0.5);
  expect(e.recordedLunch).toBe(0);
  expect(e.days[0].autoLunch).toBe(1800);
  expect(r.body.settings.auto_lunch_enabled).toBe(true);
});
it("exports automatic adjustments and policy history in a real workbook", async () => {
  const r = await manager
    .get("/api/export?week=2026-11-23")
    .buffer(true)
    .parse((res: any, cb: any) => {
      const chunks: Buffer[] = [];
      res.on("data", (b: Buffer) => chunks.push(b));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
  expect(r.status).toBe(200);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(r.body);
  const detail = book.getWorksheet("Daily detail")!;
  expect(detail.getCell("H2").value).toBe(7.5);
  expect(detail.getCell("L2").value).toBe(0.5);
  expect(detail.getCell("N2").value).toBe(0);
  expect(detail.getCell("O2").value).toBe(0.5);
  expect(book.getWorksheet("Weekly summary")!.getCell("J2").value).toBe(0.5);
  expect(book.getWorksheet("Lunch deductions")!.getCell("G2").value).toBe(0.5);
  expect(book.getWorksheet("Lunch policy audit")!.rowCount).toBe(2);
});
it("waives and restores only the automatic adjustment, requiring a reason and preserving raw punches", async () => {
  expect(
    (
      await manager
        .post("/api/lunch-exceptions")
        .set("Origin", origin)
        .send({ clock_in_id: clockIn, waived: true, reason: "" })
    ).status,
  ).toBe(400);
  const before = (await db.query("SELECT * FROM punches ORDER BY at")).rows;
  expect(
    (
      await manager
        .post("/api/lunch-exceptions")
        .set("Origin", origin)
        .send({
          clock_in_id: clockIn,
          waived: true,
          reason: "Employee worked through lunch; confirmed with supervisor",
        })
    ).status,
  ).toBe(200);
  expect(
    (await manager.get("/api/report?week=2026-11-23")).body.employees[0].total,
  ).toBe(8);
  expect(
    (
      await manager
        .post("/api/lunch-exceptions")
        .set("Origin", origin)
        .send({
          clock_in_id: clockIn,
          waived: false,
          reason: "Meal was taken; restore policy deduction",
        })
    ).status,
  ).toBe(200);
  expect(
    (await manager.get("/api/report?week=2026-11-23")).body.employees[0].total,
  ).toBe(7.5);
  const review = (await manager.get("/api/punches/" + employee)).body;
  expect(review.lunchAudit).toHaveLength(2);
  expect(review.lunchAudit[0].email).toBe("payroll@example.test");
  expect(review.lunchShifts[0].automaticLunchSeconds).toBe(1800);
  expect((await db.query("SELECT * FROM punches ORDER BY at")).rows).toEqual(
    before,
  );
});
it("disables the policy prospectively with audit history while preserving historical payroll", async () => {
  expect(
    (
      await manager
        .put("/api/lunch-policy")
        .set("Origin", origin)
        .send({ enabled: false, reason: "" })
    ).status,
  ).toBe(400);
  const before = Date.now();
  expect(
    (
      await manager
        .put("/api/lunch-policy")
        .set("Origin", origin)
        .send({
          enabled: false,
          reason: "Prospective payroll policy change",
          effective_at: "2000-01-01T00:00:00Z",
        })
    ).status,
  ).toBe(200);
  const r = (await manager.get("/api/report?week=2026-11-23")).body;
  expect(r.settings.auto_lunch_enabled).toBe(false);
  expect(r.employees[0].total).toBe(7.5);
  const policies = (await manager.get("/api/lunch-policy")).body.policies;
  expect(policies).toHaveLength(2);
  expect(policies[0].email).toBe("payroll@example.test");
  expect(new Date(policies[0].effective_at).getTime()).toBeGreaterThanOrEqual(
    before,
  );
  expect(policies[1].enabled).toBe(true);
});
it("rejects waiving an incomplete shift or a nonexistent shift", async () => {
  const id = randomUUID();
  await db.query(
    "INSERT INTO punches(id,employee_id,type,at) VALUES($1,$2,$3,$4)",
    [id, employee, "in", "2026-11-24T10:00:00Z"],
  );
  expect(
    (
      await manager
        .post("/api/lunch-exceptions")
        .set("Origin", origin)
        .send({
          clock_in_id: id,
          waived: true,
          reason: "No closed shift to adjust",
        })
    ).status,
  ).toBe(400);
  expect(
    (
      await manager
        .post("/api/lunch-exceptions")
        .set("Origin", origin)
        .send({
          clock_in_id: randomUUID(),
          waived: true,
          reason: "Unknown shift test reason",
        })
    ).status,
  ).toBe(404);
});
