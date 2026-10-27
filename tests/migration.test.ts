import { it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { migrate } from "../server/db.js";
it("upgrades the original schema without losing punches and safely repeats migrations", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(
      await readFile(new URL("../server/schema.sql", import.meta.url), "utf8"),
    );
    const e = randomUUID(),
      p = randomUUID();
    await pg.query(
      "INSERT INTO employees(id,employee_id,name,location,pin_hash,pin_lookup) VALUES($1,'OLD','Existing employee','Warehouse','hash','lookup')",
      [e],
    );
    await pg.query(
      "INSERT INTO punches(id,employee_id,type) VALUES($1,$2,'in')",
      [p, e],
    );
    const before = (await pg.query("SELECT * FROM punches WHERE id=$1", [p]))
      .rows[0];
    const db = {
      query: (s: string, params?: any[]) =>
        s.includes(";") ? pg.exec(s) : pg.query(s, params),
    };
    await migrate(db);
    await migrate(db);
    const after: any = (
      await pg.query("SELECT * FROM effective_punches WHERE id=$1", [p])
    ).rows[0];
    expect(after.at).toEqual((before as any).at);
    expect(after.employee_id).toBe(e);
    expect(after).toHaveProperty("review_decision");
    expect(
      (await pg.query("SELECT * FROM schema_migrations")).rows,
    ).toHaveLength(2);
    expect(
      (await pg.query<any>("SELECT radius_m,geofence_enabled FROM settings"))
        .rows[0],
    ).toEqual({ radius_m: 91.44, geofence_enabled: true });
  } finally {
    await pg.close();
  }
}, 20000);
