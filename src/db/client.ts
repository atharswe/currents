import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { databasePath } from "./path";
import * as schema from "./schema";

export type Db = ReturnType<typeof create>;

function create() {
  const sqlite = new Database(databasePath());

  // WAL lets the UI keep reading while a feed refresh writes. busy_timeout stops concurrent
  // refreshes from failing outright on the single writer lock.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  // SQLite leaves this off per connection, and the articles -> feeds cascade depends on it.
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "./drizzle" });
  return db;
}

// Next.js recreates modules on every hot reload in dev. Without a global cache each reload
// would open another handle to the same file and re-run the migrator.
const globalForDb = globalThis as unknown as { currentsDb?: Db };

export const db: Db = globalForDb.currentsDb ?? create();

if (process.env.NODE_ENV !== "production") {
  globalForDb.currentsDb = db;
}
