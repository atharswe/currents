import { describe, expect, it } from "vitest";
import {
  BASE_POLL_INTERVAL_MS,
  isDueForPoll,
  MAX_POLL_INTERVAL_MS,
  pollIntervalMs,
} from "./schedule";

describe("pollIntervalMs", () => {
  it("uses the base interval for a healthy feed", () => {
    expect(pollIntervalMs(0)).toBe(BASE_POLL_INTERVAL_MS);
  });

  it("treats a negative count as healthy", () => {
    expect(pollIntervalMs(-1)).toBe(BASE_POLL_INTERVAL_MS);
  });

  it("doubles with each consecutive failure", () => {
    expect(pollIntervalMs(1)).toBe(BASE_POLL_INTERVAL_MS * 2);
    expect(pollIntervalMs(2)).toBe(BASE_POLL_INTERVAL_MS * 4);
    expect(pollIntervalMs(3)).toBe(BASE_POLL_INTERVAL_MS * 8);
  });

  it("caps the interval at a day", () => {
    expect(pollIntervalMs(20)).toBe(MAX_POLL_INTERVAL_MS);
    expect(pollIntervalMs(1000)).toBe(MAX_POLL_INTERVAL_MS);
  });
});

describe("isDueForPoll", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("is due when never fetched", () => {
    expect(isDueForPoll(null, 0, now)).toBe(true);
  });

  it("is not due immediately after a successful fetch", () => {
    expect(isDueForPoll(ago(60_000), 0, now)).toBe(false);
  });

  it("is due once the base interval has elapsed", () => {
    expect(isDueForPoll(ago(BASE_POLL_INTERVAL_MS), 0, now)).toBe(true);
  });

  it("waits longer for a failing feed", () => {
    expect(isDueForPoll(ago(BASE_POLL_INTERVAL_MS), 3, now)).toBe(false);
    expect(isDueForPoll(ago(BASE_POLL_INTERVAL_MS * 8), 3, now)).toBe(true);
  });

  it("still polls a long-dead feed once a day", () => {
    expect(isDueForPoll(ago(MAX_POLL_INTERVAL_MS), 99, now)).toBe(true);
  });
});
