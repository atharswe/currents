/** How often a healthy feed is polled. */
export const BASE_POLL_INTERVAL_MS = 30 * 60 * 1000;
/** Ceiling for the backoff, so a feed that comes back is picked up within a day. */
export const MAX_POLL_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Returns how long to wait before polling a feed again.
 *
 * Failures double the interval so a host that is down, rate-limiting, or gone is not hammered
 * every cycle. The exponent is clamped before shifting because `2 ** 40` milliseconds is not a
 * schedule, it is a bug.
 */
export function pollIntervalMs(failureCount: number): number {
  if (failureCount <= 0) return BASE_POLL_INTERVAL_MS;
  const exponent = Math.min(failureCount, 10);
  return Math.min(BASE_POLL_INTERVAL_MS * 2 ** exponent, MAX_POLL_INTERVAL_MS);
}

/**
 * Decides whether a feed is due for a poll.
 *
 * A feed that has never been fetched is always due, which is what makes a newly added
 * subscription populate immediately.
 */
export function isDueForPoll(
  lastFetchedAt: Date | null,
  failureCount: number,
  now: Date = new Date(),
): boolean {
  if (!lastFetchedAt) return true;
  return (
    now.getTime() - lastFetchedAt.getTime() >= pollIntervalMs(failureCount)
  );
}
