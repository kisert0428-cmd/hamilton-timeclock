import ExcelJS from "exceljs";
import {
  beforeAll,
  afterAll,
  describe,
  it,
  expect,
  vi,
  afterEach,
} from "vitest";
import { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.js";
import { hash, lookup, secret, locationCheck } from "../server/security.js";
import { readPunchLocation } from "../src/location.js";
process.env.APP_SECRET = "location-integration-test-secret-123456789";
process.env.APP_ORIGIN = "http://localhost:3000";
const origin = "http://localhost:3000";
let pg: PGlite,
  app: any,
  manager: any,
  employeeNumber = 0;
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
const good = () => ({
  latitude: 40,
  longitude: -74,
  accuracy: 8,
  timestamp: Date.now(),
});
const outside = () => ({ ...good(), latitude: 40.01 });
async function employee() {
  const n = ++employeeNumber,
    id = randomUUID(),
    pin = String(1000 + n);
  await db.query(
    "INSERT INTO employees(id,employee_id,name,location,pin_hash,pin_lookup) VALUES($1,$2,$3,$4,$5,$6)",
    [
      id,
      "GEO-" + n,
      "Location Test " + n,
      "Warehouse",
      await hash(pin + secret()),
      lookup(pin),
    ],
  );
  return { id, pin };
}
const punch = (pin: string, coords: any, extra: any = {}) =>
  request(app)
    .post("/api/punch")
    .set("Origin", origin)
    .send({ pin, type: "in", coords, ...extra });
const post = (path: string, b: any) =>
  request(app)
    .post("/api" + path)
    .set("Origin", origin)
    .send(b);
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
  await db.query("UPDATE settings SET latitude=40,longitude=-74 WHERE id=1");
  await db.query("INSERT INTO admins VALUES($1,$2,$3)", [
    randomUUID(),
    "location@example.test",
    await hash("test-password-long-enough"),
  ]);
  app = createApp(db, tx);
  manager = request.agent(app);
  await manager.post("/api/login").set("Origin", origin).send({
    email: "location@example.test",
    password: "test-password-long-enough",
  });
}, 30000);
afterAll(async () => pg.close());
afterEach(() => vi.unstubAllGlobals());
describe("required server-side warehouse verification", () => {
  it("defaults to 300 feet and always requires verification", async () => {
    const s = (await db.query("SELECT * FROM settings")).rows[0];
    expect(s.radius_m).toBe(91.44);
    expect(s.geofence_enabled).toBe(true);
    const r = await manager
      .put("/api/settings")
      .set("Origin", origin)
      .send({ ...s, geofence_enabled: false });
    expect(r.status).toBe(400);
  });
  it("accepts inside readings for every punch action using server timestamps", async () => {
    const e = await employee();
    for (const type of ["in", "lunch_out", "lunch_in", "out"]) {
      const start = Date.now();
      const r = await punch(e.pin, good(), {
        type,
        at: "2000-01-01",
        location_check: "trusted_kiosk",
      });
      expect(r.status).toBe(200);
      expect(r.body.location_status).toBe("verified");
      expect(r.body.message).toBe("PUNCH SUCCESSFULLY RECORDED");
      expect(new Date(r.body.at).getTime()).toBeGreaterThanOrEqual(start);
      expect(r.body.flagged).toBe(false);
    }
    const ps = (
      await db.query("SELECT * FROM punches WHERE employee_id=$1", [e.id])
    ).rows;
    expect(ps).toHaveLength(4);
    expect(ps[0]).not.toHaveProperty("latitude");
    expect(ps[0].approximate_distance_m).toBe(0);
  });
  it("does not record an outside punch until explicit provisional submission, then prevents replay", async () => {
    const e = await employee();
    const r = await punch(e.pin, outside());
    expect(r.body.pending).toBe("outside");
    expect(r.body.message).toBe(
      "YOU APPEAR TO BE OUTSIDE THE AUTHORIZED WAREHOUSE AREA.",
    );
    expect(
      (await db.query("SELECT * FROM punches WHERE employee_id=$1", [e.id]))
        .rows,
    ).toHaveLength(0);
    const b = {
      attemptToken: r.body.attemptToken,
      location_check: "verified",
      coords: good(),
    };
    const results = await Promise.all([
      post("/punch/provisional", b),
      post("/punch/provisional", b),
    ]);
    for (const result of results) {
      expect(result.status).toBe(200);
      expect(result.body.flagged).toBe(true);
      expect(result.body.location_status).toBe("outside");
    }
    expect(
      (await db.query("SELECT * FROM punches WHERE employee_id=$1", [e.id]))
        .rows,
    ).toHaveLength(1);
  });
  it("records denied/unavailable GPS provisionally and cannot be upgraded by client flags", async () => {
    const e = await employee();
    const r = await punch(e.pin, null, {
      verified: true,
      kiosk: true,
      provisional: false,
      location_check: "verified",
    });
    expect(r.body.flagged).toBe(true);
    expect(r.body.location_status).toBe("unavailable");
    expect(r.body.message).toBe(
      "LOCATION COULD NOT BE VERIFIED. YOUR PUNCH HAS BEEN RECORDED FOR MANAGER REVIEW.",
    );
  });
  it("requests a fresh reading for poor accuracy and accepts an accurate inside retry", async () => {
    const e = await employee();
    const r = await punch(e.pin, { ...good(), accuracy: 600 });
    expect(r.body.pending).toBe("retry");
    expect(
      (await db.query("SELECT * FROM punches WHERE employee_id=$1", [e.id]))
        .rows,
    ).toHaveLength(0);
    const retry = await post("/punch/retry", {
      attemptToken: r.body.attemptToken,
      coords: good(),
    });
    expect(retry.body.location_status).toBe("verified");
  });
  it("never treats poor indoor accuracy as proof of being outside and flags a second poor reading", async () => {
    const e = await employee();
    const poor = { ...outside(), accuracy: 2000 };
    const r = await punch(e.pin, poor);
    expect(r.body.pending).toBe("retry");
    const retry = await post("/punch/retry", {
      attemptToken: r.body.attemptToken,
      coords: poor,
    });
    expect(retry.body.location_status).toBe("poor_accuracy");
    expect(retry.body.flagged).toBe(true);
  });
  it("requires explicit submission if a fresh accurate reading is outside", async () => {
    const e = await employee();
    const r = await punch(e.pin, { ...good(), accuracy: 600 });
    const retry = await post("/punch/retry", {
      attemptToken: r.body.attemptToken,
      coords: outside(),
    });
    expect(retry.body.pending).toBe("outside");
    expect(
      (await db.query("SELECT * FROM punches WHERE employee_id=$1", [e.id]))
        .rows,
    ).toHaveLength(0);
  });
  it("treats uncertainty at the boundary, stale readings and missing configuration conservatively", () => {
    const s = { latitude: 40, longitude: -74, radius_m: 91.44 };
    expect(
      locationCheck(s, { ...good(), latitude: 40.0008, accuracy: 15 }, false)
        .status,
    ).toBe("poor_accuracy");
    expect(
      locationCheck(s, { ...good(), timestamp: Date.now() - 130000 }, false)
        .status,
    ).toBe("unavailable");
    expect(locationCheck({ ...s, latitude: null }, good(), false).status).toBe(
      "unavailable",
    );
    expect(
      locationCheck(s, { ...good(), timestamp: Date.now() + 60000 }, false)
        .status,
    ).toBe("unavailable");
  });
  it("retains expired outside attempts for management and rejects unknown tokens", async () => {
    const e = await employee(),
      r = await punch(e.pin, outside());
    await db.query(
      "UPDATE location_attempts SET expires_at=clock_timestamp()-interval '1 second' WHERE employee_id=$1",
      [e.id],
    );
    expect(
      (await post("/punch/provisional", { attemptToken: r.body.attemptToken }))
        .status,
    ).toBe(410);
    expect(
      (await post("/punch/provisional", { attemptToken: "0".repeat(64) }))
        .status,
    ).toBe(404);
    const records = (await manager.get("/api/location-reviews")).body;
    expect(
      records.attempts.some((a: any) =>
        a.name.includes(String(employeeNumber)),
      ),
    ).toBe(true);
  });
  it("protects kiosk registration, uses opaque device credentials, supports revocation and records a device audit", async () => {
    expect(
      (await post("/kiosk", { enabled: true, name: "Unauthorized" })).status,
    ).toBe(401);
    expect((await request(app).get("/api/kiosks")).status).toBe(401);
    const kiosk = request.agent(app);
    await kiosk.post("/api/login").set("Origin", origin).send({
      email: "location@example.test",
      password: "test-password-long-enough",
    });
    const registration = await kiosk
      .post("/api/kiosk")
      .set("Origin", origin)
      .send({ enabled: true, name: "Entrance tablet" });
    expect(registration.status).toBe(200);
    expect(
      (registration.headers["set-cookie"] as unknown as string[]).some(
        (c: string) =>
          c.startsWith("kiosk=") &&
          c.includes("HttpOnly") &&
          c.includes("SameSite=Strict"),
      ),
    ).toBe(true);
    expect((await kiosk.get("/api/me")).status).toBe(401);
    const e = await employee();
    const r = await kiosk
      .post("/api/punch")
      .set("Origin", origin)
      .send({ pin: e.pin, type: "in" });
    expect(r.body.location_status).toBe("trusted_kiosk");
    expect(r.body.flagged).toBe(false);
    const devices = (await manager.get("/api/kiosks")).body;
    expect(devices).toHaveLength(1);
    expect(devices[0]).not.toHaveProperty("token_hash");
    expect(
      (
        await manager
          .delete("/api/kiosks/" + devices[0].id)
          .set("Origin", origin)
      ).status,
    ).toBe(200);
    expect((await kiosk.get("/api/config")).body.kiosk).toBe(false);
    const after = await kiosk
      .post("/api/punch")
      .set("Origin", origin)
      .send({ pin: e.pin, type: "out", kiosk: true });
    expect(after.body.location_status).toBe("unavailable");
    const forged = await request(app)
      .get("/api/config?kiosk=true")
      .set("Cookie", "kiosk=9999999999999.invalid");
    expect(forged.body.kiosk).toBe(false);
    expect(
      (await manager.get("/api/location-reviews")).body.kioskAudit
        .map((a: any) => a.action)
        .sort(),
    ).toEqual(["registered", "revoked"]);
  });
  it("requires a manager reason, audits decisions, preserves time, and invalidates approvals after corrections", async () => {
    const e = await employee();
    await punch(e.pin, null);
    const p = (
      await db.query("SELECT * FROM punches WHERE employee_id=$1", [e.id])
    ).rows[0];
    expect(
      (
        await post("/location-reviews/" + p.id, {
          decision: "approved",
          reason: "fake approval",
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await manager
          .post("/api/location-reviews/" + p.id)
          .set("Origin", origin)
          .send({ decision: "approved", reason: "" })
      ).status,
    ).toBe(400);
    for (const decision of ["follow_up", "approved"])
      expect(
        (
          await manager
            .post("/api/location-reviews/" + p.id)
            .set("Origin", origin)
            .send({ decision, reason: "Confirmed with on-site supervisor" })
        ).status,
      ).toBe(200);
    expect(
      (
        await db.query(
          "SELECT review_decision FROM effective_punches WHERE id=$1",
          [p.id],
        )
      ).rows[0].review_decision,
    ).toBe("approved");
    const r = await manager
      .post("/api/corrections")
      .set("Origin", origin)
      .send({
        employee_id: e.id,
        punch_id: p.id,
        type: "in",
        at: new Date(new Date(p.at).getTime() - 1000).toISOString(),
        reason: "Correct verified start time",
      });
    expect(r.status).toBe(200);
    expect(
      (
        await db.query(
          "SELECT review_decision FROM effective_punches WHERE id=$1",
          [p.id],
        )
      ).rows[0].review_decision,
    ).toBe(null);
    const audit = (await manager.get("/api/location-reviews")).body.audit;
    expect(audit.filter((a: any) => a.punch_id === p.id)).toHaveLength(2);
    expect(
      audit.find((a: any) => a.punch_id === p.id && a.decision === "approved")
        .previous_decision,
    ).toBe("follow_up");
    expect(
      (await db.query("SELECT at FROM punches WHERE id=$1", [p.id])).rows[0].at,
    ).toEqual(p.at);
  });
  it("audits resolution of abandoned attempts without adding or deleting time", async () => {
    const e = await employee();
    const pending = await punch(e.pin, outside());
    const a = (
      await db.query("SELECT id FROM location_attempts WHERE employee_id=$1", [
        e.id,
      ])
    ).rows[0];
    expect(
      (
        await post("/location-attempts/" + a.id + "/review", {
          reason: "Employee called manager",
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await manager
          .post("/api/location-attempts/" + a.id + "/review")
          .set("Origin", origin)
          .send({ reason: "" })
      ).status,
    ).toBe(400);
    const r = await manager
      .post("/api/location-attempts/" + a.id + "/review")
      .set("Origin", origin)
      .send({ reason: "Confirmed accidental attempt; no worked time to add" });
    expect(r.status).toBe(200);
    const data = (await manager.get("/api/location-reviews")).body;
    expect(data.attempts.find((row: any) => row.id === a.id)).toBeUndefined();
    expect(
      data.attemptAudit.find((row: any) => row.attempt_id === a.id).reason,
    ).toContain("Confirmed accidental");
    expect(
      (await db.query("SELECT * FROM location_attempts WHERE id=$1", [a.id]))
        .rows,
    ).toHaveLength(1);
    expect(
      (await db.query("SELECT * FROM punches WHERE employee_id=$1", [e.id]))
        .rows,
    ).toHaveLength(0);
    expect(
      (
        await post("/punch/provisional", {
          attemptToken: pending.body.attemptToken,
        })
      ).status,
    ).toBe(409);
  });
  it("exports punch verification statuses and manager decision audit in Excel", async () => {
    const r = await manager
      .get("/api/export")
      .buffer(true)
      .parse((res: any, cb: any) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(r.status).toBe(200);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(r.body);
    const sheet = book.getWorksheet("Location verification")!;
    const statuses: any[] = [];
    sheet.eachRow((r, i) => {
      if (i > 1) statuses.push(r.getCell(5).value);
    });
    expect(statuses).toContain("Verified at Warehouse");
    expect(statuses).toContain("Trusted Warehouse Kiosk");
    expect(statuses).toContain("Outside Geofence — Review Required");
    expect(statuses).toContain("Poor GPS Accuracy — Review Required");
    expect(
      book.getWorksheet("Location review audit")!.rowCount,
    ).toBeGreaterThan(1);
  });
});
describe("location permission lifecycle", () => {
  it("returns null on permission denial without watching or tracking", async () => {
    const get = vi.fn((_ok: any, fail: any, _options: any) =>
        fail({ code: 1 }),
      ),
      watch = vi.fn();
    vi.stubGlobal("navigator", {
      geolocation: { getCurrentPosition: get, watchPosition: watch },
    });
    expect(get).not.toHaveBeenCalled();
    expect(await readPunchLocation()).toBe(null);
    expect(get).toHaveBeenCalledOnce();
    expect(watch).not.toHaveBeenCalled();
    expect(get.mock.calls[0][2]).toMatchObject({
      maximumAge: 0,
      enableHighAccuracy: true,
    });
  });
  it("passes a one-shot browser reading including accuracy and timestamp", async () => {
    const get = vi.fn((ok) =>
      ok({
        coords: { latitude: 40, longitude: -74, accuracy: 12 },
        timestamp: 12345,
      }),
    );
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: get } });
    expect(await readPunchLocation()).toEqual({
      latitude: 40,
      longitude: -74,
      accuracy: 12,
      timestamp: 12345,
    });
  });
});
