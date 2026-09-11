import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { articles, feeds } from "@/db/schema";
import type { ParsedItem } from "./parse";
import { applyParsedItems } from "./refresh";

function item(overrides: Partial<ParsedItem> = {}): ParsedItem {
  return {
    guid: "guid-1",
    url: "https://example.com/1",
    title: "Original title",
    author: "Author",
    summary: "Original summary",
    content: "<p>Original body</p>",
    publishedAt: new Date("2026-04-01T00:00:00Z"),
    ...overrides,
  };
}

let db: Db;
let feedId: number;

beforeEach(() => {
  db = createDb(":memory:");
  const inserted = db
    .insert(feeds)
    .values({ feedUrl: "https://example.com/feed.xml", title: "Example" })
    .returning({ id: feeds.id })
    .get();
  feedId = inserted.id;
});

function ftsMatchCount(query: string): number {
  const row = db.get<{ count: number }>(
    sql`select count(*) as count from articles_fts where articles_fts match ${query}`,
  );
  return Number(row?.count ?? 0);
}

describe("applyParsedItems", () => {
  it("inserts new items", () => {
    const result = applyParsedItems(db, feedId, [
      item(),
      item({ guid: "guid-2" }),
    ]);
    expect(result).toEqual({ inserted: 2, updated: 0 });
    expect(db.select().from(articles).all()).toHaveLength(2);
  });

  it("does nothing on an unchanged re-poll", () => {
    applyParsedItems(db, feedId, [item()]);
    expect(applyParsedItems(db, feedId, [item()])).toEqual({
      inserted: 0,
      updated: 0,
    });
    expect(db.select().from(articles).all()).toHaveLength(1);
  });

  it("updates an item whose text the publisher changed", () => {
    applyParsedItems(db, feedId, [item()]);
    const result = applyParsedItems(db, feedId, [
      item({ title: "Corrected title" }),
    ]);
    expect(result).toEqual({ inserted: 0, updated: 1 });

    const stored = db.select().from(articles).get();
    expect(stored?.title).toBe("Corrected title");
  });

  it("keeps read and starred state when an item is edited", () => {
    applyParsedItems(db, feedId, [item()]);
    db.update(articles).set({ isRead: true, isStarred: true }).run();

    applyParsedItems(db, feedId, [item({ content: "<p>Edited body</p>" })]);

    const stored = db.select().from(articles).get();
    expect(stored?.isRead).toBe(true);
    expect(stored?.isStarred).toBe(true);
    expect(stored?.content).toBe("<p>Edited body</p>");
  });

  it("treats the same guid in two feeds as two articles", () => {
    const other = db
      .insert(feeds)
      .values({ feedUrl: "https://other.example/feed.xml", title: "Other" })
      .returning({ id: feeds.id })
      .get();

    applyParsedItems(db, feedId, [item()]);
    applyParsedItems(db, other.id, [item()]);

    expect(db.select().from(articles).all()).toHaveLength(2);
  });

  it("handles an empty item list without opening a transaction", () => {
    expect(applyParsedItems(db, feedId, [])).toEqual({
      inserted: 0,
      updated: 0,
    });
  });

  it("stores a null publishedAt", () => {
    applyParsedItems(db, feedId, [item({ publishedAt: null })]);
    expect(db.select().from(articles).get()?.publishedAt).toBeNull();
  });
});

describe("full-text search index", () => {
  it("indexes newly inserted articles", () => {
    applyParsedItems(db, feedId, [
      item({ title: "Distributed consensus explained" }),
    ]);
    expect(ftsMatchCount("consensus")).toBe(1);
  });

  it("stems words so a search for a root form matches inflections", () => {
    applyParsedItems(db, feedId, [
      item({ content: "<p>Running the migration</p>" }),
    ]);
    expect(ftsMatchCount("run")).toBe(1);
  });

  it("reflects edits instead of matching stale terms", () => {
    applyParsedItems(db, feedId, [item({ title: "Kubernetes basics" })]);
    applyParsedItems(db, feedId, [item({ title: "Nomad basics" })]);

    expect(ftsMatchCount("kubernetes")).toBe(0);
    expect(ftsMatchCount("nomad")).toBe(1);
  });

  it("drops articles from the index when they are deleted", () => {
    applyParsedItems(db, feedId, [item({ title: "Ephemeral post" })]);
    db.delete(articles).run();
    expect(ftsMatchCount("ephemeral")).toBe(0);
  });

  it("searches author names", () => {
    applyParsedItems(db, feedId, [item({ author: "Radia Perlman" })]);
    expect(ftsMatchCount("perlman")).toBe(1);
  });
});

describe("cascade delete", () => {
  it("removes a feed's articles and their search index entries", () => {
    applyParsedItems(db, feedId, [item({ title: "Doomed article" })]);
    db.delete(feeds).where(eq(feeds.id, feedId)).run();

    expect(db.select().from(articles).all()).toHaveLength(0);
    expect(ftsMatchCount("doomed")).toBe(0);
  });
});
