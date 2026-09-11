import { getDb } from "@/db/client";
import { refreshAllFeeds } from "@/lib/feed/refresh";

const TICK_MS = 5 * 60 * 1000;
const FIRST_TICK_MS = 20 * 1000;

let started = false;

/**
 * Polls due feeds in the background while the process is alive.
 *
 * First tick is delayed so boot (migrations, first request) is not competing with a
 * six-way fetch. Subsequent ticks rely on the per-feed backoff in `isDueForPoll`.
 */
export function startRefreshLoop(): void {
  if (started) return;
  started = true;

  const tick = async () => {
    try {
      await refreshAllFeeds(getDb());
    } catch (error) {
      console.error("scheduled refresh failed:", error);
    }
  };

  setTimeout(() => {
    void tick();
    setInterval(() => {
      void tick();
    }, TICK_MS);
  }, FIRST_TICK_MS);
}
