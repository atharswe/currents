import type { ArticleFilter, CountSummary } from "@/server/queries";

export type ClientFeed = {
  id: number;
  title: string;
  feedUrl: string;
  siteUrl: string | null;
  folder: string;
  unreadCount: number;
  lastError: string | null;
  lastFetchedAt: string | null;
};

export type ClientArticle = {
  id: number;
  feedId: number;
  feedTitle: string;
  title: string;
  url: string | null;
  author: string | null;
  summary: string | null;
  publishedAt: string | null;
  isRead: boolean;
  isStarred: boolean;
};

export type ClientArticleDetail = ClientArticle & {
  content: string | null;
  feedSiteUrl: string | null;
};

export type ReaderProps = {
  feeds: ClientFeed[];
  counts: CountSummary;
  folders: string[];
  articles: ClientArticle[];
  nextCursor: string | null;
  selected: ClientArticleDetail | null;
  filter: ArticleFilter;
  feedId: number | null;
  query: string;
};
