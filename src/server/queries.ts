import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { type Db, getDb } from "@/db/client";
import { articles, feeds } from "@/db/schema";
import { toFtsQuery } from "@/lib/search";

function conn(db?: Db): Db {
  return db ?? getDb();
}

export type ArticleFilter = "all" | "unread" | "starred";

export type FeedSummary = {
  id: number;
  title: string;
  feedUrl: string;
  siteUrl: string | null;
  folder: string;
  unreadCount: number;
  lastError: string | null;
  lastFetchedAt: Date | null;
};

export type ArticleListItem = {
  id: number;
  feedId: number;
  feedTitle: string;
  title: string;
  url: string | null;
  author: string | null;
  summary: string | null;
  publishedAt: Date | null;
  isRead: boolean;
  isStarred: boolean;
};

export type ArticleDetail = ArticleListItem & {
  content: string | null;
  feedSiteUrl: string | null;
};

export const PAGE_SIZE = 50;

/**
 * Articles are ordered by publication date, falling back to when we first saw them.
 *
 * Plenty of feeds omit dates entirely, and those items would otherwise sort to the bottom
 * forever and never be seen.
 */
const sortKey = sql<number>`coalesce(${articles.publishedAt}, ${articles.fetchedAt})`;

/** Sidebar data: every feed with its unread count, plus the last error if it is failing. */
export function listFeeds(db?: Db): FeedSummary[] {
  const rows = conn(db)
    .select({
      id: feeds.id,
      title: feeds.title,
      feedUrl: feeds.feedUrl,
      siteUrl: feeds.siteUrl,
      folder: feeds.folder,
      lastError: feeds.lastError,
      lastFetchedAt: feeds.lastFetchedAt,
      unreadCount: sql<number>`(
        select count(*) from ${articles}
        where ${eq(articles.feedId, feeds.id)} and ${eq(articles.isRead, false)}
      )`,
    })
    .from(feeds)
    .orderBy(feeds.folder, feeds.title)
    .all();

  return rows.map((row) => ({ ...row, unreadCount: Number(row.unreadCount) }));
}

export type CountSummary = { unread: number; starred: number; total: number };

export function countArticles(db?: Db): CountSummary {
  const row = conn(db)
    .select({
      unread: sql<number>`sum(case when ${articles.isRead} = 0 then 1 else 0 end)`,
      starred: sql<number>`sum(case when ${articles.isStarred} = 1 then 1 else 0 end)`,
      total: sql<number>`count(*)`,
    })
    .from(articles)
    .get();

  return {
    unread: Number(row?.unread ?? 0),
    starred: Number(row?.starred ?? 0),
    total: Number(row?.total ?? 0),
  };
}

/**
 * An opaque keyset cursor: the sort key and id of the last row on the previous page.
 *
 * Keyset rather than OFFSET because a refresh inserting new articles mid-scroll would shift
 * every offset and make the reader show duplicates or skip items.
 */
export type ArticleCursor = { sortKey: number; id: number };

export function encodeCursor(cursor: ArticleCursor): string {
  return `${cursor.sortKey}_${cursor.id}`;
}

export function decodeCursor(raw: string | undefined | null): ArticleCursor | null {
  if (!raw) return null;
  const [key, id] = raw.split("_");
  const parsedKey = Number(key);
  const parsedId = Number(id);
  if (!Number.isFinite(parsedKey) || !Number.isInteger(parsedId)) return null;
  return { sortKey: parsedKey, id: parsedId };
}

export type ListArticlesOptions = {
  db?: Db;
  feedId?: number;
  filter?: ArticleFilter;
  search?: string;
  cursor?: ArticleCursor | null;
  limit?: number;
};

export type ArticlePage = {
  items: ArticleListItem[];
  nextCursor: string | null;
};

/**
 * The main timeline query, covering the unread/starred filters, per-feed views, and search.
 *
 * Search results are ordered by publication date rather than FTS relevance. For a reader,
 * "what is newest among the matches" is almost always the question being asked.
 */
export function listArticles(options: ListArticlesOptions = {}): ArticlePage {
  const {
    db,
    feedId,
    filter = "all",
    search,
    cursor,
    limit = PAGE_SIZE,
  } = options;

  const conditions = [];

  if (feedId !== undefined) conditions.push(eq(articles.feedId, feedId));
  if (filter === "unread") conditions.push(eq(articles.isRead, false));
  if (filter === "starred") conditions.push(eq(articles.isStarred, true));

  const ftsQuery = search ? toFtsQuery(search) : null;
  if (ftsQuery) {
    conditions.push(
      sql`${articles.id} in (select rowid from articles_fts where articles_fts match ${ftsQuery})`,
    );
  }

  // Strictly "older than the last row we showed", with id breaking ties between articles that
  // share a timestamp. Without the tiebreak, same-second items can repeat across pages.
  if (cursor) {
    conditions.push(
      or(
        lt(sortKey, cursor.sortKey),
        and(eq(sortKey, cursor.sortKey), lt(articles.id, cursor.id)),
      ),
    );
  }

  const rows = conn(db)
    .select({
      id: articles.id,
      feedId: articles.feedId,
      feedTitle: feeds.title,
      title: articles.title,
      url: articles.url,
      author: articles.author,
      summary: articles.summary,
      publishedAt: articles.publishedAt,
      isRead: articles.isRead,
      isStarred: articles.isStarred,
      sortKey,
    })
    .from(articles)
    .innerJoin(feeds, eq(feeds.id, articles.feedId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(sortKey), desc(articles.id))
    // One extra row is fetched purely to learn whether another page exists.
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);

  return {
    items: page.map(({ sortKey: _sortKey, ...item }) => item),
    nextCursor:
      hasMore && last ? encodeCursor({ sortKey: Number(last.sortKey), id: last.id }) : null,
  };
}

export function getArticle(id: number, db?: Db): ArticleDetail | null {
  const row = conn(db)
    .select({
      id: articles.id,
      feedId: articles.feedId,
      feedTitle: feeds.title,
      feedSiteUrl: feeds.siteUrl,
      title: articles.title,
      url: articles.url,
      author: articles.author,
      summary: articles.summary,
      content: articles.content,
      publishedAt: articles.publishedAt,
      isRead: articles.isRead,
      isStarred: articles.isStarred,
    })
    .from(articles)
    .innerJoin(feeds, eq(feeds.id, articles.feedId))
    .where(eq(articles.id, id))
    .get();

  return row ?? null;
}

/** Distinct folder names, for the sidebar grouping and the folder picker. */
export function listFolders(db?: Db): string[] {
  return conn(db)
    .selectDistinct({ folder: feeds.folder })
    .from(feeds)
    .orderBy(feeds.folder)
    .all()
    .map((row) => row.folder);
}
