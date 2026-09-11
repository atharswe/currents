/**
 * Applies pending migrations and exits. The app also migrates on first DB access, but a
 * standalone entrypoint lets containers and CI run the step explicitly before serving traffic.
 */
import { createDb } from "./client";
import { databasePath } from "./path";

try {
  const path = databasePath();
  createDb(path);
  console.log(`migrations applied to ${path}`);
} catch (error) {
  console.error("migration failed:", error);
  process.exit(1);
}
