/**
 * Applies pending migrations and exits. The app also migrates on first DB access, but a
 * standalone entrypoint lets containers and CI run the step explicitly before serving traffic.
 */
import { databasePath } from "./path";

async function main() {
  const path = databasePath();
  await import("./client");
  console.log(`migrations applied to ${path}`);
}

main().catch((error) => {
  console.error("migration failed:", error);
  process.exit(1);
});
