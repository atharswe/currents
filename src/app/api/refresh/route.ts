import { getDb } from "@/db/client";
import { refreshAllFeeds } from "@/lib/feed/refresh";

export const dynamic = "force-dynamic";

/**
 * External cron entrypoint. If `CURRENTS_REFRESH_SECRET` is set, callers must send
 * `Authorization: Bearer <secret>`.
 */
export async function POST(request: Request) {
  const secret = process.env.CURRENTS_REFRESH_SECRET;
  if (secret) {
    const header = request.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (token !== secret) {
      return Response.json(
        { ok: false, error: "unauthorized" },
        { status: 401 },
      );
    }
  }

  const force = new URL(request.url).searchParams.get("force") === "1";
  const outcomes = await refreshAllFeeds(getDb(), { force });
  return Response.json({
    ok: true,
    feeds: outcomes.length,
    inserted: outcomes.reduce((sum, outcome) => sum + outcome.inserted, 0),
    failed: outcomes.filter((outcome) => outcome.error).length,
  });
}
