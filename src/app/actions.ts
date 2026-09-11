"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { feeds } from "@/db/schema";
import { refreshAllFeeds, refreshFeed } from "@/lib/feed/refresh";
import { SubscribeError, subscribeToFeed } from "@/lib/feed/subscribe";
import {
  deleteFeed,
  markAllRead,
  markFeedRead,
  moveFeed,
  renameFeed,
  setReadState,
  setStarred,
} from "@/server/mutations";
import {
  type ArticleFilter,
  type ArticlePage,
  decodeCursor,
  getArticle,
  listArticles,
} from "@/server/queries";

export type ActionResult =
  | { ok: true; message: string; feedId?: number }
  | { ok: false; message: string };

const idSchema = z.coerce.number().int().positive();
const filterSchema = z.enum(["all", "unread", "starred"]);

function revalidateReader() {
  revalidatePath("/");
}

export async function subscribeAction(
  formData: FormData,
): Promise<ActionResult> {
  const parsed = z
    .object({
      url: z.string().trim().min(1, "paste a feed URL or a blog homepage"),
      folder: z.string().trim().optional(),
      title: z.string().trim().optional(),
    })
    .safeParse({
      url: formData.get("url"),
      folder: formData.get("folder") || undefined,
      title: formData.get("title") || undefined,
    });

  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "invalid input",
    };
  }

  try {
    const result = await subscribeToFeed(getDb(), parsed.data.url, {
      folder: parsed.data.folder,
      title: parsed.data.title,
    });
    revalidateReader();
    if (result.alreadyExisted) {
      return {
        ok: true,
        message: `Already subscribed to ${result.title}. Pulled ${result.inserted} new articles.`,
        feedId: result.feedId,
      };
    }
    return {
      ok: true,
      message: `Subscribed to ${result.title}. ${result.inserted} articles ready.`,
      feedId: result.feedId,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof SubscribeError
          ? error.message
          : "could not subscribe to that URL",
    };
  }
}

export async function refreshAction(feedId?: number): Promise<ActionResult> {
  try {
    if (feedId !== undefined) {
      const id = idSchema.parse(feedId);
      const feed = getDb().select().from(feeds).where(eq(feeds.id, id)).get();
      if (!feed) return { ok: false, message: "feed not found" };
      const outcome = await refreshFeed(getDb(), feed);
      revalidateReader();
      if (outcome.error) {
        return { ok: false, message: `${outcome.feedTitle}: ${outcome.error}` };
      }
      return {
        ok: true,
        message: outcome.notModified
          ? `${outcome.feedTitle} has not changed`
          : `${outcome.feedTitle}: ${outcome.inserted} new, ${outcome.updated} updated`,
      };
    }

    const outcomes = await refreshAllFeeds(getDb(), { force: true });
    revalidateReader();
    const failed = outcomes.filter((outcome) => outcome.error);
    const inserted = outcomes.reduce(
      (sum, outcome) => sum + outcome.inserted,
      0,
    );
    if (outcomes.length === 0) {
      return { ok: true, message: "no feeds to refresh" };
    }
    if (failed.length === outcomes.length) {
      return { ok: false, message: `every feed failed (${failed[0]?.error})` };
    }
    return {
      ok: true,
      message: `Refreshed ${outcomes.length} feeds, ${inserted} new articles${
        failed.length > 0 ? `, ${failed.length} failed` : ""
      }.`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "refresh failed",
    };
  }
}

export async function setReadAction(
  articleId: number,
  isRead: boolean,
): Promise<ActionResult> {
  const id = idSchema.parse(articleId);
  if (!setReadState(getDb(), id, isRead)) {
    return { ok: false, message: "article not found" };
  }
  revalidateReader();
  return { ok: true, message: isRead ? "marked read" : "marked unread" };
}

export async function setStarredAction(
  articleId: number,
  isStarred: boolean,
): Promise<ActionResult> {
  const id = idSchema.parse(articleId);
  if (!setStarred(getDb(), id, isStarred)) {
    return { ok: false, message: "article not found" };
  }
  revalidateReader();
  return { ok: true, message: isStarred ? "starred" : "unstarred" };
}

export async function markFeedReadAction(
  feedId: number,
): Promise<ActionResult> {
  const id = idSchema.parse(feedId);
  const changes = markFeedRead(getDb(), id);
  revalidateReader();
  return { ok: true, message: `marked ${changes} articles read` };
}

export async function markAllReadAction(): Promise<ActionResult> {
  const changes = markAllRead(getDb());
  revalidateReader();
  return { ok: true, message: `marked ${changes} articles read` };
}

export async function unsubscribeAction(feedId: number): Promise<ActionResult> {
  const id = idSchema.parse(feedId);
  if (!deleteFeed(getDb(), id)) {
    return { ok: false, message: "feed not found" };
  }
  revalidateReader();
  return { ok: true, message: "unsubscribed" };
}

export async function renameFeedAction(
  feedId: number,
  title: string,
): Promise<ActionResult> {
  const id = idSchema.parse(feedId);
  if (!renameFeed(getDb(), id, title)) {
    return { ok: false, message: "could not rename that feed" };
  }
  revalidateReader();
  return { ok: true, message: "renamed" };
}

export async function moveFeedAction(
  feedId: number,
  folder: string,
): Promise<ActionResult> {
  const id = idSchema.parse(feedId);
  if (!moveFeed(getDb(), id, folder)) {
    return { ok: false, message: "could not move that feed" };
  }
  revalidateReader();
  return { ok: true, message: "moved" };
}

export async function loadMoreAction(input: {
  feedId?: number;
  filter: ArticleFilter;
  search?: string;
  cursor: string;
}): Promise<ArticlePage> {
  const filter = filterSchema.parse(input.filter);
  const feedId =
    input.feedId === undefined ? undefined : idSchema.parse(input.feedId);
  return listArticles({
    feedId,
    filter,
    search: input.search,
    cursor: decodeCursor(input.cursor),
  });
}

export async function getArticleAction(id: number) {
  const article = getArticle(idSchema.parse(id));
  if (!article) return null;
  return {
    ...article,
    publishedAt: article.publishedAt ? article.publishedAt.toISOString() : null,
  };
}

export async function importOpmlAction(
  formData: FormData,
): Promise<ActionResult> {
  const file = formData.get("opml");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "choose an OPML file" };
  }
  if (file.size > 2 * 1024 * 1024) {
    return { ok: false, message: "OPML file is larger than 2MB" };
  }

  const { OpmlError, parseOpml } = await import("@/lib/opml");
  let outlines: { title: string; xmlUrl: string; folder: string }[];
  try {
    outlines = parseOpml(await file.text());
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof OpmlError
          ? error.message
          : "could not read that OPML file",
    };
  }

  if (outlines.length === 0) {
    return { ok: false, message: "that OPML file has no feeds in it" };
  }

  const db = getDb();
  let subscribed = 0;
  let failed = 0;
  const CONCURRENCY = 4;

  for (let index = 0; index < outlines.length; index += CONCURRENCY) {
    const batch = outlines.slice(index, index + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((outline) =>
        subscribeToFeed(db, outline.xmlUrl, {
          folder: outline.folder,
          title: outline.title,
        }),
      ),
    );
    for (const result of results) {
      if (result.status === "fulfilled") subscribed += 1;
      else failed += 1;
    }
  }

  revalidateReader();
  return {
    ok: failed === 0,
    message:
      failed === 0
        ? `Imported ${subscribed} feeds`
        : `Imported ${subscribed} feeds, ${failed} failed`,
  };
}
