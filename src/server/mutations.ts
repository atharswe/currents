import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { articles, feeds } from "@/db/schema";

export function setReadState(
  db: Db,
  articleId: number,
  isRead: boolean,
): boolean {
  const result = db
    .update(articles)
    .set({
      isRead,
      readAt: isRead ? new Date() : null,
    })
    .where(eq(articles.id, articleId))
    .run();
  return result.changes > 0;
}

export function setStarred(
  db: Db,
  articleId: number,
  isStarred: boolean,
): boolean {
  const result = db
    .update(articles)
    .set({ isStarred })
    .where(eq(articles.id, articleId))
    .run();
  return result.changes > 0;
}

export function markFeedRead(db: Db, feedId: number): number {
  const result = db
    .update(articles)
    .set({ isRead: true, readAt: new Date() })
    .where(eq(articles.feedId, feedId))
    .run();
  return result.changes;
}

export function markAllRead(db: Db): number {
  const result = db
    .update(articles)
    .set({ isRead: true, readAt: new Date() })
    .run();
  return result.changes;
}

export function deleteFeed(db: Db, feedId: number): boolean {
  const result = db.delete(feeds).where(eq(feeds.id, feedId)).run();
  return result.changes > 0;
}

export function renameFeed(db: Db, feedId: number, title: string): boolean {
  const trimmed = title.trim();
  if (trimmed.length === 0) return false;
  const result = db
    .update(feeds)
    .set({ title: trimmed })
    .where(eq(feeds.id, feedId))
    .run();
  return result.changes > 0;
}

export function moveFeed(db: Db, feedId: number, folder: string): boolean {
  const trimmed = folder.trim() || "Unsorted";
  const result = db
    .update(feeds)
    .set({ folder: trimmed })
    .where(eq(feeds.id, feedId))
    .run();
  return result.changes > 0;
}
