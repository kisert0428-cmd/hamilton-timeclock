import { analyze } from "../server/time.js";
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
      "INSERT INTO punches(id,employee_id,type,at) VALUES($1,$2,'in','2000-01-03T14:00:00Z')",
      [p, e],
    );
    await pg.query(
      "INSERT INTO punches(id,employee_id,type,at) VALUES($1,$2,'out','2000-01-03T22:00:00Z')",
      [randomUUID(), e],
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
    const policies: any[] = (
      await pg.query("SELECT * FROM lunch_policies ORDER BY effective_at,id")
    ).rows;
    expect(policies).toHaveLength(1);
    expect(policies[0].enabled).toBe(true);
    expect(policies[0].minimum_shift_minutes).toBe(360);
    const historic: any[] = (
      await pg.query("SELECT * FROM effective_punches ORDER BY at")
    ).rows;
    expect(analyze(historic, "2000-01-03", 1, Date.now(), policies).total).toBe(
      8,
    );
    expect(after.at).toEqual((before as any).at);
    expect(after.employee_id).toBe(e);
    expect(after).toHaveProperty("review_decision");
    expect(
      (await pg.query("SELECT * FROM schema_migrations")).rows,
    ).toHaveLength(3);
    expect(
      (await pg.query<any>("SELECT radius_m,geofence_enabled FROM settings"))
        .rows[0],
    ).toEqual({ radius_m: 91.44, geofence_enabled: true });
  } finally {
    await pg.close();
  }
}, 20000);
