import type { Route } from "next";
import type { ArticleFilter } from "@/server/queries";

export type ReaderQuery = {
  filter: ArticleFilter;
  feedId: number | null;
  articleId: number | null;
  q: string;
};

export function readerHref(query: ReaderQuery): Route {
  const params = new URLSearchParams();
  if (query.filter !== "all") params.set("filter", query.filter);
  if (query.feedId !== null) params.set("feed", String(query.feedId));
  if (query.articleId !== null) params.set("article", String(query.articleId));
  if (query.q.trim().length > 0) params.set("q", query.q.trim());
  const encoded = params.toString();
  return (encoded.length > 0 ? `/?${encoded}` : "/") as Route;
}
