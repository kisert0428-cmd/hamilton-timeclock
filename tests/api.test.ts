import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.js";
import { hash, lookup, secret } from "../server/security.js";
import { locationCheck } from "../server/security.js";
process.env.APP_SECRET = "integration-test-secret-only-123456789";
process.env.APP_ORIGIN = "http://localhost:3000";
let pg: PGlite, app: any, agent: any, id: string, punchID: string;
const origin = "http://localhost:3000";
const db: any = {
  query: async (sql: string, params: any[] = []) => {
    const r: any = await pg.query(sql, params);
    return { ...r, rowCount: r.affectedRows ?? r.rows.length };
  },
};
let tail = Promise.resolve();
const tx = (fn: any) => {
  const result = tail.then(() =>
    pg.transaction((c) =>
      fn({ query: (s: string, p: any[]) => c.query(s, p) }),
    ),
  );
  tail = result.then(
    () => {},
    () => {},
  );
  return result;
};
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(
    await readFile(new URL("../server/schema.sql", import.meta.url), "utf8"),
  );
  await pg.exec(
    await readFile(
      new URL("../migrations/002-location.sql", import.meta.url),
      "utf8",
    ),
  );
  const a = randomUUID();
  await db.query("INSERT INTO admins VALUES($1,$2,$3)", [
    a,
    "admin@example.test",
    await hash("test-password-long-enough"),
  ]);
  id = randomUUID();
  await db.query(
    "INSERT INTO employees(id,employee_id,name,location,pin_hash,pin_lookup) VALUES($1,$2,$3,$4,$5,$6)",
    [
      id,
      "TEST-001",
      "Test Employee",
      "Test Warehouse",
      await hash("1234" + secret()),
      lookup("1234"),
    ],
  );
  app = createApp(db, tx);
  agent = request.agent(app);
}, 30000);
afterAll(async () => {
  await pg.close();
});
describe("API security and persistence", () => {
  it("rejects unauthorized management access and cross-origin punches", async () => {
    expect((await request(app).get("/api/employees")).status).toBe(401);
    expect((await request(app).get("/api/export")).status).toBe(401);
    expect(
      (await request(app).post("/api/punch").send({ pin: "1234", type: "in" }))
        .status,
    ).toBe(403);
  });
  it("rejects invalid PIN without revealing employees", async () => {
    const r = await request(app)
      .post("/api/punch")
      .set("Origin", origin)
      .send({ pin: "9999", type: "in" });
    expect(r.status).toBe(401);
    expect(r.text).not.toContain("Test Employee");
  });
  it("serializes duplicate simultaneous punches", async () => {
    const r = await Promise.all(
      [1, 2].map(() =>
        request(app)
          .post("/api/punch")
          .set("Origin", origin)
          .send({ pin: "1234", type: "in" }),
      ),
    );
    expect(r.map((x) => x.status).sort()).toEqual([200, 409]);
    const p = (await db.query("SELECT * FROM punches")).rows;
    expect(p).toHaveLength(1);
    punchID = p[0].id;
    expect(r.find((x) => x.status === 200)!.body.name).toBe("Test Employee");
  });
  it("allows lunch and clock out and persists timestamps", async () => {
    for (const type of ["lunch_out", "lunch_in", "out"]) {
      await new Promise((r) => setTimeout(r, 3));
      expect(
        (
          await request(app)
            .post("/api/punch")
            .set("Origin", origin)
            .send({ pin: "1234", type })
        ).status,
      ).toBe(200);
    }
    expect((await db.query("SELECT * FROM punches")).rows).toHaveLength(4);
  });
  it("logs in with separate admin credentials", async () => {
    expect(
      (
        await agent
          .post("/api/login")
          .set("Origin", origin)
          .send({ email: "admin@example.test", password: "wrong" })
      ).status,
    ).toBe(401);
    expect(
      (
        await agent.post("/api/login").set("Origin", origin).send({
          email: "admin@example.test",
          password: "test-password-long-enough",
        })
      ).status,
    ).toBe(200);
    const r = await agent.get("/api/employees");
    expect(r.status).toBe(200);
    expect(r.body[0]).not.toHaveProperty("pin_hash");
    expect(r.body[0]).not.toHaveProperty("pin_lookup");
  });
  it("requires a reason and preserves original punch with audited correction", async () => {
    expect(
      (
        await agent.post("/api/corrections").set("Origin", origin).send({
          employee_id: id,
          punch_id: punchID,
          type: "in",
          at: "2026-01-01T12:00:00Z",
          reason: "",
        })
      ).status,
    ).toBe(400);
    const original = (
      await db.query("SELECT at FROM punches WHERE id=$1", [punchID])
    ).rows[0].at;
    const r = await agent.post("/api/corrections").set("Origin", origin).send({
      employee_id: id,
      punch_id: punchID,
      type: "in",
      at: "2026-01-01T12:00:00Z",
      reason: "Test correction reason",
    });
    expect(r.status).toBe(200);
    expect(
      (await db.query("SELECT at FROM punches WHERE id=$1", [punchID])).rows[0]
        .at,
    ).toEqual(original);
    expect((await db.query("SELECT * FROM corrections")).rows).toHaveLength(1);
  });
  it("exports a readable Excel workbook with detail, summary, and audit", async () => {
    const r = await agent
      .get("/api/export?week=2026-10-26")
      .buffer(true)
      .parse((res: any, cb: any) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(r.status).toBe(200);
    const b = new ExcelJS.Workbook();
    await b.xlsx.load(r.body);
    expect(b.worksheets.map((s) => s.name)).toEqual([
      "Daily detail",
      "Weekly summary",
      "Punch corrections",
      "Location verification",
      "Location review audit",
    ]);
    expect(b.getWorksheet("Weekly summary")!.getCell("B2").value).toBe(
      "Test Employee",
    );
    expect(b.getWorksheet("Daily detail")!.rowCount).toBe(8);
  });
  it("creates employees with unique hashed PINs and resets them", async () => {
    const r = await agent.post("/api/employees").set("Origin", origin).send({
      employee_id: "TEST-003",
      name: "New Test Employee",
      location: "Second warehouse",
    });
    expect(r.status).toBe(201);
    expect(r.body.pin).toMatch(/^\d{4}$/);
    const stored = (
      await db.query("SELECT * FROM employees WHERE id=$1", [r.body.id])
    ).rows[0];
    expect(stored.pin_hash).not.toBe(r.body.pin);
    expect(stored.pin_hash).toContain("$argon2id$");
    const reset = await agent
      .post("/api/employees/" + r.body.id + "/pin")
      .set("Origin", origin)
      .send({});
    expect(reset.status).toBe(200);
    expect(reset.body.pin).not.toBe(r.body.pin);
    expect(
      (
        await request(app)
          .post("/api/punch")
          .set("Origin", origin)
          .send({ pin: r.body.pin, type: "in" })
      ).status,
    ).toBe(401);
    expect(
      (
        await agent.post("/api/employees").set("Origin", origin).send({
          employee_id: "TEST-003",
          name: "Duplicate",
          location: "Warehouse",
        })
      ).status,
    ).toBe(409);
  });
  it("audits missing-punch additions with an original null value and correction timestamp", async () => {
    const e = (
      await db.query("SELECT id FROM employees WHERE employee_id=$1", [
        "TEST-003",
      ])
    ).rows[0];
    const r = await agent.post("/api/corrections").set("Origin", origin).send({
      employee_id: e.id,
      type: "in",
      at: "2026-01-05T12:00:00Z",
      reason: "Employee forgot to clock in",
    });
    expect(r.status).toBe(200);
    const audit = (await agent.get("/api/punches/" + e.id)).body.audit;
    expect(audit).toHaveLength(1);
    expect(audit[0].original_value).toEqual({ type: null, at: null });
    expect(audit[0].corrected_value.type).toBe("in");
    expect(audit[0].at).toBeTruthy();
    expect(audit[0].email).toBe("admin@example.test");
  });
  it("enrolls a kiosk separately from administrator sessions and resists tampering", async () => {
    const kiosk = request.agent(app);
    await kiosk.post("/api/login").set("Origin", origin).send({
      email: "admin@example.test",
      password: "test-password-long-enough",
    });
    const r = await kiosk
      .post("/api/kiosk")
      .set("Origin", origin)
      .send({ enabled: true });
    expect(r.status).toBe(200);
    expect((await kiosk.get("/api/config")).body.kiosk).toBe(true);
    expect((await kiosk.get("/api/employees")).status).toBe(401);
    expect(
      (
        await request(app)
          .get("/api/config")
          .set("Cookie", "kiosk=9999999999999.invalid")
      ).body.kiosk,
    ).toBe(false);
  });
  it("validates geofence settings before enabling and reports configuration", async () => {
    const s = {
      workweek_start: 7,
      long_shift_hours: 12,
      geofence_enabled: true,
      latitude: null,
      longitude: null,
      radius_m: 300,
    };
    expect(
      (await agent.put("/api/settings").set("Origin", origin).send(s)).status,
    ).toBe(400);
    expect(
      (
        await agent
          .put("/api/settings")
          .set("Origin", origin)
          .send({ ...s, latitude: 40, longitude: -74 })
      ).status,
    ).toBe(200);
    expect((await request(app).get("/api/config")).body.workweek_start).toBe(7);
    await agent
      .put("/api/settings")
      .set("Origin", origin)
      .send({ ...s, workweek_start: 1, geofence_enabled: true });
  });
  it("deactivation immediately blocks PIN access", async () => {
    await agent
      .patch("/api/employees/" + id)
      .set("Origin", origin)
      .send({
        name: "Test Employee",
        location: "Test Warehouse",
        active: false,
      });
    expect(
      (
        await request(app)
          .post("/api/punch")
          .set("Origin", origin)
          .send({ pin: "1234", type: "in" })
      ).status,
    ).toBe(401);
  });
  it("rate limits repeated attempts and rejects invalid correction order", async () => {
    for (let i = 0; i < 21; i++) {
      const r = await request(app)
        .post("/api/punch")
        .set("Origin", origin)
        .send({ pin: "7777", type: "in" });
      if (i === 20) expect(r.status).toBe(429);
    }
    const r = await agent.post("/api/corrections").set("Origin", origin).send({
      employee_id: id,
      type: "out",
      at: "2025-01-01T12:00:00Z",
      reason: "Invalid first punch",
    });
    expect(r.status).toBe(409);
  });
  it("records simultaneous different employees independently", async () => {
    const other = randomUUID();
    await db.query(
      "INSERT INTO employees(id,employee_id,name,location,pin_hash,pin_lookup) VALUES($1,$2,$3,$4,$5,$6)",
      [
        other,
        "TEST-002",
        "Other Test",
        "Warehouse",
        await hash("4321" + secret()),
        lookup("4321"),
      ],
    );
    await db.query("UPDATE employees SET active=true WHERE id=$1", [id]);
    const rs = await Promise.all(
      ["1234", "4321"].map((pin) =>
        request(app)
          .post("/api/punch")
          .set("Origin", origin)
          .send({ pin, type: "in" }),
      ),
    );
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
  });
});
describe("location privacy policy", () => {
  const s = { latitude: 40, longitude: -74, radius_m: 91.44 };
  it("classifies locations on the server with conservative uncertainty", () => {
    const coords = {
      latitude: 40,
      longitude: -74,
      accuracy: 10,
      timestamp: Date.now(),
    };
    expect(locationCheck(s, null, false).status).toBe("unavailable");
    expect(locationCheck(s, { ...coords, latitude: 41 }, false).status).toBe(
      "outside",
    );
    expect(locationCheck(s, coords, false).status).toBe("verified");
    expect(locationCheck(s, null, true).status).toBe("trusted_kiosk");
    expect(locationCheck(s, { ...coords, accuracy: 500 }, false).status).toBe(
      "poor_accuracy",
    );
  });
});
