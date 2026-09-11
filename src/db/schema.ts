import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * A subscription to an RSS/Atom/RDF feed.
 *
 * `etag` and `lastModified` are echoed back as conditional-GET headers on the next poll so
 * well-behaved servers can answer 304 instead of resending the whole document.
 */
export const feeds = sqliteTable(
  "feeds",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Address of the feed document itself, not the site it describes. */
    feedUrl: text("feed_url").notNull(),
    /** Human-readable name, taken from the feed and overridable by the user. */
    title: text("title").notNull(),
    /** Homepage the feed points at, used for the "visit site" affordance. */
    siteUrl: text("site_url"),
    description: text("description"),
    /** Flat grouping label. Flat beats nested here: folder trees are rarely worth the UI cost. */
    folder: text("folder").notNull().default("Unsorted"),
    etag: text("etag"),
    lastModified: text("last_modified"),
    lastFetchedAt: integer("last_fetched_at", { mode: "timestamp_ms" }),
    /** Message from the most recent failed poll. Cleared on the next success. */
    lastError: text("last_error"),
    /** Consecutive failures. Drives backoff so a dead host is not hammered every cycle. */
    failureCount: integer("failure_count").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [uniqueIndex("feeds_feed_url_unique").on(table.feedUrl)],
);

/**
 * A single entry from a feed.
 *
 * `guid` is whatever stable identifier the feed gave us (`<guid>`, `<id>`, or the link as a
 * fallback). It is unique per feed rather than globally, because the same article syndicated
 * through two feeds is legitimately two rows with independent read state.
 */
export const articles = sqliteTable(
  "articles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    feedId: integer("feed_id")
      .notNull()
      .references(() => feeds.id, { onDelete: "cascade" }),
    guid: text("guid").notNull(),
    url: text("url"),
    title: text("title").notNull(),
    author: text("author"),
    /** Short plain-text excerpt for list rows. */
    summary: text("summary"),
    /** Sanitized article body when the feed ships full text. */
    content: text("content"),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    fetchedAt: integer("fetched_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
    isStarred: integer("is_starred", { mode: "boolean" })
      .notNull()
      .default(false),
    readAt: integer("read_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("articles_feed_guid_unique").on(table.feedId, table.guid),
    // Drives the default reverse-chronological timeline.
    index("articles_published_at_idx").on(table.publishedAt),
    // Drives per-feed unread counts and the unread-only filter.
    index("articles_feed_read_idx").on(table.feedId, table.isRead),
  ],
);

export const feedsRelations = relations(feeds, ({ many }) => ({
  articles: many(articles),
}));

export const articlesRelations = relations(articles, ({ one }) => ({
  feed: one(feeds, {
    fields: [articles.feedId],
    references: [feeds.id],
  }),
}));

export type Feed = typeof feeds.$inferSelect;
export type NewFeed = typeof feeds.$inferInsert;
export type Article = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;
