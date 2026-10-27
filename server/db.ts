import "dotenv/config";
import pg from "pg";
import { readFile } from "node:fs/promises";
const local = process.env.DEV_DATABASE_PATH;
if (local && process.env.NODE_ENV === "production")
  throw new Error("Development database is forbidden in production");
let embedded: any = null;
if (local) {
  const { PGlite } = await import("@electric-sql/pglite");
  embedded = new PGlite(local);
}
export const pool: any = embedded
  ? {
      query: async (s: string, p: any[] = []) => {
        const r = await embedded.query(s, p);
        return { ...r, rowCount: r.affectedRows ?? r.rows.length };
      },
      end: () => embedded.close(),
    }
  : new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
export async function migrate(db: any = pool) {
  const run = async (c: any, exec: (sql: string) => Promise<any>) => {
    await c.query("SELECT pg_advisory_xact_lock(12002)");
    await exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, at timestamptz NOT NULL DEFAULT clock_timestamp())",
    );
    for (const [id, file] of [
      ["001", "./schema.sql"],
      ["002", "../migrations/002-location.sql"],
    ]) {
      if (
        !(await c.query("SELECT id FROM schema_migrations WHERE id=$1", [id]))
          .rows.length
      ) {
        await exec(await readFile(new URL(file, import.meta.url), "utf8"));
        await c.query("INSERT INTO schema_migrations(id) VALUES($1)", [id]);
      }
    }
  };
  if (embedded && db === pool)
    await embedded.transaction((c: any) => run(c, (s) => c.exec(s)));
  else {
    const c = db.connect ? await db.connect() : db;
    try {
      await c.query("BEGIN");
      await run(c, (s) => c.query(s));
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      if (c !== db) c.release();
    }
  }
}
let queue = Promise.resolve();
export async function transaction<T>(
  fn: (client: any) => Promise<T>,
): Promise<T> {
  if (embedded) {
    const result = queue.then(() =>
      embedded.transaction((c: any) =>
        fn({ query: (s: string, p: any[]) => c.query(s, p) }),
      ),
    );
    queue = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
