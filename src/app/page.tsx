import { Reader } from "@/components/reader";
import {
  type ArticleFilter,
  countArticles,
  getArticle,
  listArticles,
  listFeeds,
  listFolders,
} from "@/server/queries";

export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positiveInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const filterRaw = first(params.filter);
  const filter: ArticleFilter =
    filterRaw === "unread" || filterRaw === "starred" ? filterRaw : "all";
  const feedId = positiveInt(first(params.feed));
  const articleId = positiveInt(first(params.article));
  const query = first(params.q) ?? "";

  const feeds = listFeeds();
  const counts = countArticles();
  const page = listArticles({
    feedId: feedId ?? undefined,
    filter,
    search: query,
  });
  const selected =
    (articleId ? getArticle(articleId) : null) ??
    (page.items[0] ? getArticle(page.items[0].id) : null);

  return (
    <Reader
      feeds={feeds.map((feed) => ({
        ...feed,
        lastFetchedAt: iso(feed.lastFetchedAt),
      }))}
      counts={counts}
      folders={listFolders()}
      articles={page.items.map((item) => ({
        ...item,
        publishedAt: iso(item.publishedAt),
      }))}
      nextCursor={page.nextCursor}
      selected={
        selected
          ? {
              ...selected,
              publishedAt: iso(selected.publishedAt),
            }
          : null
      }
      filter={filter}
      feedId={feedId}
      query={query}
    />
  );
}
