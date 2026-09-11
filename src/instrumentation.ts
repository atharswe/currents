export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.CURRENTS_DISABLE_SCHEDULER === "true") return;

  const { startRefreshLoop } = await import("./lib/feed/loop");
  startRefreshLoop();
}
