import { eq, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { feeds } from "@/db/schema";
import {
  discoverFeedUrls,
  FeedFetchError,
  fetchFeed,
  looksLikeHtml,
} from "./fetch";
import { FeedParseError, type ParsedFeed, parseFeed } from "./parse";
import { applyParsedItems } from "./refresh";
import { UnsafeUrlError } from "./url-guard";

export class SubscribeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubscribeError";
  }
}

export type SubscribeResult = {
  feedId: number;
  title: string;
  feedUrl: string;
  alreadyExisted: boolean;
  inserted: number;
};

type ResolvedFeed = {
  body: string;
  finalUrl: string;
  etag: string | null;
  lastModified: string | null;
  parsed: ParsedFeed;
};

function asSubscribeError(error: unknown): SubscribeError {
  if (error instanceof SubscribeError) return error;
  if (
    error instanceof FeedFetchError ||
    error instanceof FeedParseError ||
    error instanceof UnsafeUrlError
  ) {
    return new SubscribeError(error.message);
  }
  return new SubscribeError(
    error instanceof Error ? error.message : "could not subscribe to that URL",
  );
}

/**
 * Turns a user-pasted URL into a parsed feed document.
 *
 * People paste homepages more often than `/feed.xml`, so HTML responses are inspected for
 * `<link rel="alternate">` before we give up. Each discovered link is tried in document order
 * until one actually parses as RSS/Atom.
 */
async function resolveFeedDocument(rawUrl: string): Promise<ResolvedFeed> {
  const first = await fetchFeed(rawUrl);
  if (first.status === "not-modified") {
    throw new SubscribeError(
      "server reported the document unchanged on a first fetch",
    );
  }

  if (!looksLikeHtml(first.body, first.contentType)) {
    return {
      body: first.body,
      finalUrl: first.finalUrl,
      etag: first.etag,
      lastModified: first.lastModified,
      parsed: parseFeed(first.body, first.finalUrl),
    };
  }

  const discovered = discoverFeedUrls(first.body, first.finalUrl);
  if (discovered.length === 0) {
    throw new SubscribeError(
      "that page has no RSS or Atom feed we could find — paste the feed URL itself",
    );
  }

  const errors: string[] = [];
  for (const candidate of discovered) {
    try {
      const next = await fetchFeed(candidate);
      if (next.status === "not-modified") continue;
      if (looksLikeHtml(next.body, next.contentType)) continue;
      return {
        body: next.body,
        finalUrl: next.finalUrl,
        etag: next.etag,
        lastModified: next.lastModified,
        parsed: parseFeed(next.body, next.finalUrl),
      };
    } catch (error) {
      errors.push(
        `${candidate}: ${error instanceof Error ? error.message : "failed"}`,
      );
    }
  }

  throw new SubscribeError(
    `found feed links but none of them parsed${errors.length > 0 ? ` (${errors.join("; ")})` : ""}`,
  );
}

function findExisting(db: Db, pastedUrl: string, finalUrl: string) {
  return db
    .select()
    .from(feeds)
    .where(or(eq(feeds.feedUrl, finalUrl), eq(feeds.feedUrl, pastedUrl)))
    .get();
}

/**
 * Subscribes to a feed URL (or a homepage that advertises one) and stores its current items.
 *
 * Re-subscribing to a URL we already have is a refresh, not an error: the unique constraint on
 * `feed_url` would reject a second row, and the user almost always meant "get me the latest".
 */
export async function subscribeToFeed(
  db: Db,
  rawUrl: string,
  options: { folder?: string; title?: string } = {},
): Promise<SubscribeResult> {
  const pasted = rawUrl.trim();
  if (pasted.length === 0) {
    throw new SubscribeError("paste a feed URL or a blog homepage");
  }

  let resolved: ResolvedFeed;
  try {
    resolved = await resolveFeedDocument(pasted);
  } catch (error) {
    throw asSubscribeError(error);
  }

  const folder = options.folder?.trim() || "Unsorted";
  const existing = findExisting(db, pasted, resolved.finalUrl);

  if (existing) {
    const counts = applyParsedItems(db, existing.id, resolved.parsed.items);
    db.update(feeds)
      .set({
        etag: resolved.etag,
        lastModified: resolved.lastModified,
        lastFetchedAt: new Date(),
        lastError: null,
        failureCount: 0,
        siteUrl: resolved.parsed.siteUrl ?? existing.siteUrl,
        description: resolved.parsed.description ?? existing.description,
      })
      .where(eq(feeds.id, existing.id))
      .run();

    return {
      feedId: existing.id,
      title: existing.title,
      feedUrl: existing.feedUrl,
      alreadyExisted: true,
      inserted: counts.inserted,
    };
  }

  const title =
    options.title?.trim() || resolved.parsed.title.trim() || resolved.finalUrl;

  const created = db
    .insert(feeds)
    .values({
      feedUrl: resolved.finalUrl,
      title,
      siteUrl: resolved.parsed.siteUrl,
      description: resolved.parsed.description,
      folder,
      etag: resolved.etag,
      lastModified: resolved.lastModified,
      lastFetchedAt: new Date(),
    })
    .returning()
    .get();

  const counts = applyParsedItems(db, created.id, resolved.parsed.items);

  return {
    feedId: created.id,
    title: created.title,
    feedUrl: created.feedUrl,
    alreadyExisted: false,
    inserted: counts.inserted,
  };
}
