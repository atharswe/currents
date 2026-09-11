import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { articles, type Feed, feeds } from "@/db/schema";
import { FeedFetchError, fetchFeed } from "./fetch";
import {
  FeedParseError,
  type ParsedFeed,
  type ParsedItem,
  parseFeed,
} from "./parse";
import { isDueForPoll } from "./schedule";

export type RefreshOutcome = {
  feedId: number;
  feedTitle: string;
  /** New articles stored by this refresh. */
  inserted: number;
  /** Existing articles whose text the publisher changed. */
  updated: number;
  /** True when the server answered 304 and there was nothing to do. */
  notModified: boolean;
  error: string | null;
};

/**
 * Writes parsed items into the database, returning how many were new versus edited.
 *
 * Read and starred state is deliberately absent from the update set: a publisher fixing a typo
 * must not resurrect an article the user already read.
 */
export function applyParsedItems(
  db: Db,
  feedId: number,
  items: ParsedItem[],
): { inserted: number; updated: number } {
  if (items.length === 0) return { inserted: 0, updated: 0 };

  let inserted = 0;
  let updated = 0;

  db.transaction((tx) => {
    for (const item of items) {
      const existing = tx
        .select({
          id: articles.id,
          title: articles.title,
          summary: articles.summary,
          content: articles.content,
          url: articles.url,
        })
        .from(articles)
        .where(and(eq(articles.feedId, feedId), eq(articles.guid, item.guid)))
        .get();

      if (!existing) {
        tx.insert(articles)
          .values({
            feedId,
            guid: item.guid,
            url: item.url,
            title: item.title,
            author: item.author,
            summary: item.summary,
            content: item.content,
            publishedAt: item.publishedAt,
          })
          .run();
        inserted += 1;
        continue;
      }

      // Skipping no-op writes matters more than it looks: every UPDATE fires the FTS triggers,
      // which delete and reinsert the article's terms in the search index.
      const unchanged =
        existing.title === item.title &&
        existing.summary === item.summary &&
        existing.content === item.content &&
        existing.url === item.url;
      if (unchanged) continue;

      tx.update(articles)
        .set({
          url: item.url,
          title: item.title,
          author: item.author,
          summary: item.summary,
          content: item.content,
          publishedAt: item.publishedAt,
        })
        .where(eq(articles.id, existing.id))
        .run();
      updated += 1;
    }
  });

  return { inserted, updated };
}

/** Copies feed-level metadata the publisher may have changed, without clobbering user edits. */
function metadataUpdates(feed: Feed, parsed: ParsedFeed) {
  return {
    // The stored title wins if the user renamed the feed away from its original title.
    title: feed.title.trim().length > 0 ? feed.title : parsed.title,
    siteUrl: parsed.siteUrl ?? feed.siteUrl,
    description: parsed.description ?? feed.description,
  };
}

/**
 * Fetches, parses, and stores one feed, recording success or failure on the feed row.
 *
 * Errors are captured rather than thrown: one unreachable feed should not abort a refresh of
 * the other forty, and the message is worth showing in the sidebar.
 */
export async function refreshFeed(db: Db, feed: Feed): Promise<RefreshOutcome> {
  const base: Omit<
    RefreshOutcome,
    "inserted" | "updated" | "notModified" | "error"
  > = {
    feedId: feed.id,
    feedTitle: feed.title,
  };

  try {
    const result = await fetchFeed(feed.feedUrl, {
      etag: feed.etag,
      lastModified: feed.lastModified,
    });

    if (result.status === "not-modified") {
      db.update(feeds)
        .set({ lastFetchedAt: new Date(), lastError: null, failureCount: 0 })
        .where(eq(feeds.id, feed.id))
        .run();
      return {
        ...base,
        inserted: 0,
        updated: 0,
        notModified: true,
        error: null,
      };
    }

    const parsed = parseFeed(result.body, result.finalUrl);
    const counts = applyParsedItems(db, feed.id, parsed.items);

    db.update(feeds)
      .set({
        ...metadataUpdates(feed, parsed),
        etag: result.etag,
        lastModified: result.lastModified,
        lastFetchedAt: new Date(),
        lastError: null,
        failureCount: 0,
      })
      .where(eq(feeds.id, feed.id))
      .run();

    return { ...base, ...counts, notModified: false, error: null };
  } catch (error) {
    const message =
      error instanceof FeedFetchError || error instanceof FeedParseError
        ? error.message
        : error instanceof Error
          ? error.message
          : "unknown error";

    db.update(feeds)
      .set({
        lastFetchedAt: new Date(),
        lastError: message,
        failureCount: sql`${feeds.failureCount} + 1`,
      })
      .where(eq(feeds.id, feed.id))
      .run();

    return {
      ...base,
      inserted: 0,
      updated: 0,
      notModified: false,
      error: message,
    };
  }
}

/** How many feeds are fetched at once. Enough to be quick, few enough to stay polite. */
const REFRESH_CONCURRENCY = 6;

/**
 * Refreshes every feed, or only those due for a poll.
 *
 * `force` is what the manual refresh button uses; the scheduled path leaves it off so backoff
 * and conditional GET can do their job.
 */
export async function refreshAllFeeds(
  db: Db,
  options: { force?: boolean } = {},
): Promise<RefreshOutcome[]> {
  const all = db.select().from(feeds).all();
  const due = options.force
    ? all
    : all.filter((feed) => isDueForPoll(feed.lastFetchedAt, feed.failureCount));

  const outcomes: RefreshOutcome[] = [];
  for (let index = 0; index < due.length; index += REFRESH_CONCURRENCY) {
    const batch = due.slice(index, index + REFRESH_CONCURRENCY);
    outcomes.push(
      ...(await Promise.all(batch.map((feed) => refreshFeed(db, feed)))),
    );
  }
  return outcomes;
}
