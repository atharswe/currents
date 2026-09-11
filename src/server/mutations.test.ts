import { beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { articles, feeds } from "@/db/schema";
import {
  deleteFeed,
  markAllRead,
  markFeedRead,
  moveFeed,
  renameFeed,
  setReadState,
  setStarred,
} from "./mutations";

let db: Db;
let feedId: number;
let otherFeedId: number;
let articleId: number;

beforeEach(() => {
  db = createDb(":memory:");
  feedId = db
    .insert(feeds)
    .values({ feedUrl: "https://a.example/feed.xml", title: "A" })
    .returning({ id: feeds.id })
    .get().id;
  otherFeedId = db
    .insert(feeds)
    .values({ feedUrl: "https://b.example/feed.xml", title: "B" })
    .returning({ id: feeds.id })
    .get().id;

  articleId = db
    .insert(articles)
    .values({
      feedId,
      guid: "a1",
      title: "One",
      isRead: false,
      isStarred: false,
    })
    .returning({ id: articles.id })
    .get().id;

  db.insert(articles)
    .values({
      feedId: otherFeedId,
      guid: "b1",
      title: "Two",
      isRead: false,
    })
    .run();
});

describe("article flags", () => {
  it("marks an article read and records when", () => {
    expect(setReadState(db, articleId, true)).toBe(true);
    const stored = db
      .select()
      .from(articles)
      .all()
      .find((article) => article.id === articleId);
    expect(stored?.isRead).toBe(true);
    expect(stored?.readAt).toBeInstanceOf(Date);
  });

  it("clears readAt when marking unread", () => {
    setReadState(db, articleId, true);
    setReadState(db, articleId, false);
    const stored = db
      .select()
      .from(articles)
      .all()
      .find((article) => article.id === articleId);
    expect(stored?.isRead).toBe(false);
    expect(stored?.readAt).toBeNull();
  });

  it("stars an article", () => {
    expect(setStarred(db, articleId, true)).toBe(true);
    expect(
      db
        .select()
        .from(articles)
        .all()
        .find((article) => article.id === articleId)?.isStarred,
    ).toBe(true);
  });

  it("returns false for a missing article", () => {
    expect(setReadState(db, 999, true)).toBe(false);
    expect(setStarred(db, 999, true)).toBe(false);
  });
});

describe("bulk read", () => {
  it("marks one feed without touching the other", () => {
    expect(markFeedRead(db, feedId)).toBe(1);
    const rows = db.select().from(articles).all();
    expect(rows.find((row) => row.feedId === feedId)?.isRead).toBe(true);
    expect(rows.find((row) => row.feedId === otherFeedId)?.isRead).toBe(false);
  });

  it("marks everything", () => {
    expect(markAllRead(db)).toBe(2);
    expect(
      db
        .select()
        .from(articles)
        .all()
        .every((row) => row.isRead),
    ).toBe(true);
  });
});

describe("feed edits", () => {
  it("renames, moves, and deletes, cascading articles", () => {
    expect(renameFeed(db, feedId, "  Renamed  ")).toBe(true);
    expect(moveFeed(db, feedId, "News")).toBe(true);
    const feed = db
      .select()
      .from(feeds)
      .all()
      .find((row) => row.id === feedId);
    expect(feed?.title).toBe("Renamed");
    expect(feed?.folder).toBe("News");

    expect(deleteFeed(db, feedId)).toBe(true);
    expect(db.select().from(feeds).all()).toHaveLength(1);
    expect(db.select().from(articles).all()).toHaveLength(1);
  });

  it("rejects a blank title", () => {
    expect(renameFeed(db, feedId, "   ")).toBe(false);
  });
});
