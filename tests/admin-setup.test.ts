import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import request from "supertest";
import { createApp } from "../server/app.js";
const setupToken = "test-only-initial-activation-key-123456789";
process.env.APP_SECRET = "test-app-secret-for-admin-setup-123456789";
process.env.APP_ORIGIN = "http://localhost:3000";
process.env.ADMIN_SETUP_TOKEN = setupToken;
let pg: PGlite, app: any;
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
const post = (b: any) =>
  request(app)
    .post("/api/setup")
    .set("Origin", "http://localhost:3000")
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
  app = createApp(db, tx);
}, 30000);
afterAll(async () => pg.close());
it("offers setup without exposing a setup key or administrator email", async () => {
  const r = await request(app).get("/api/setup-status");
  expect(r.body).toEqual({ available: true });
  expect(r.text).not.toContain(setupToken);
});
it("rejects missing/wrong keys, short passwords and cross-origin activation", async () => {
  expect(
    (
      await post({
        email: "owner@example.test",
        password: "long-password-for-tests",
        setupToken: "incorrect-token-that-is-long-enough",
      })
    ).status,
  ).toBe(403);
  expect(
    (await post({ email: "owner@example.test", password: "short", setupToken }))
      .status,
  ).toBe(400);
  expect(
    (
      await request(app)
        .post("/api/setup")
        .send({
          email: "owner@example.test",
          password: "long-password-for-tests",
          setupToken,
        })
    ).status,
  ).toBe(403);
  expect((await db.query("SELECT * FROM admins")).rows).toHaveLength(0);
});
it("creates exactly one administrator under simultaneous requests, hashing the password and disabling setup", async () => {
  const rs = await Promise.all([
    post({
      email: "owner@example.test",
      password: "long-password-for-tests",
      setupToken,
    }),
    post({
      email: "other@example.test",
      password: "long-password-for-tests",
      setupToken,
    }),
  ]);
  expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
  const rows = (await db.query("SELECT * FROM admins")).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0].password_hash).toContain("$argon2id$");
  expect((await request(app).get("/api/setup-status")).body.available).toBe(
    false,
  );
  expect(
    (
      await post({
        email: "third@example.test",
        password: "long-password-for-tests",
        setupToken,
      })
    ).status,
  ).toBe(409);
  const r = await request(app)
    .post("/api/login")
    .set("Origin", "http://localhost:3000")
    .send({ email: rows[0].email, password: "long-password-for-tests" });
  expect(r.status).toBe(200);
});
