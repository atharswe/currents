import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DEFAULT_PATH = "./data/currents.db";

/**
 * Resolves the SQLite file location and guarantees its parent directory exists.
 *
 * Kept separate from the client so `drizzle.config.ts` can reuse it without pulling in the
 * driver or triggering migrations.
 */
export function databasePath(): string {
  const configured = process.env.DATABASE_PATH?.trim();
  const target = resolve(
    configured && configured.length > 0 ? configured : DEFAULT_PATH,
  );
  if (target !== ":memory:") {
    mkdirSync(dirname(target), { recursive: true });
  }
  return target;
}
