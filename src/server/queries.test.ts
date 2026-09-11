import { beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/db/client";
import { articles, feeds } from "@/db/schema";
import {
  countArticles,
  decodeCursor,
  encodeCursor,
  getArticle,
  listArticles,
  listFeeds,
  listFolders,
} from "./queries";

let db: Db;
let newsId: number;
let techId: number;

function seed() {
  newsId = db
    .insert(feeds)
    .values({
      feedUrl: "https://news.example/feed.xml",
      title: "News",
      folder: "Daily",
    })
    .returning({ id: feeds.id })
    .get().id;

  techId = db
    .insert(feeds)
    .values({
      feedUrl: "https://tech.example/atom.xml",
      title: "Tech",
      folder: "Daily",
    })
    .returning({ id: feeds.id })
    .get().id;

  db.insert(articles)
    .values([
      {
        feedId: newsId,
        guid: "n1",
        title: "Morning briefing",
        summary: "World headlines",
        content: "<p>World headlines</p>",
        publishedAt: new Date("2026-04-03T08:00:00Z"),
        isRead: false,
      },
      {
        feedId: newsId,
        guid: "n2",
        title: "Evening recap",
        summary: "What happened later",
        publishedAt: new Date("2026-04-03T18:00:00Z"),
        isRead: true,
      },
      {
        feedId: techId,
        guid: "t1",
        title: "SQLite tricks",
        summary: "Full-text search with FTS5",
        content: "<p>FTS5 is excellent for readers</p>",
        publishedAt: new Date("2026-04-02T12:00:00Z"),
        isRead: false,
        isStarred: true,
      },
      {
        feedId: techId,
        guid: "t2",
        title: "No date item",
        summary: "Should still appear",
        publishedAt: null,
        fetchedAt: new Date("2026-04-01T00:00:00Z"),
        isRead: false,
      },
    ])
    .run();
}

beforeEach(() => {
  db = createDb(":memory:");
  seed();
});

describe("listFeeds", () => {
  it("returns unread counts and groups by folder then title", () => {
    const listed = listFeeds(db);
    expect(listed.map((feed) => feed.title)).toEqual(["News", "Tech"]);
    expect(listed[0]?.unreadCount).toBe(1);
    expect(listed[1]?.unreadCount).toBe(2);
    expect(listed.every((feed) => feed.folder === "Daily")).toBe(true);
  });
});

describe("countArticles", () => {
  it("summarises unread, starred, and total", () => {
    expect(countArticles(db)).toEqual({ unread: 3, starred: 1, total: 4 });
  });

  it("returns zeros on an empty database", () => {
    const empty = createDb(":memory:");
    expect(countArticles(empty)).toEqual({ unread: 0, starred: 0, total: 0 });
  });
});

describe("listArticles", () => {
  it("orders by published date, falling back to fetchedAt", () => {
    const { items } = listArticles({ db });
    expect(items.map((item) => item.title)).toEqual([
      "Evening recap",
      "Morning briefing",
      "SQLite tricks",
      "No date item",
    ]);
  });

  it("filters unread and starred", () => {
    expect(
      listArticles({ db, filter: "unread" }).items.map((item) => item.title),
    ).toEqual(["Morning briefing", "SQLite tricks", "No date item"]);
    expect(
      listArticles({ db, filter: "starred" }).items.map((item) => item.title),
    ).toEqual(["SQLite tricks"]);
  });

  it("scopes to a single feed", () => {
    const { items } = listArticles({ db, feedId: newsId });
    expect(items.map((item) => item.title)).toEqual([
      "Evening recap",
      "Morning briefing",
    ]);
  });

  it("pages with a keyset cursor without repeating rows", () => {
    const first = listArticles({ db, limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();

    const second = listArticles({
      db,
      limit: 2,
      cursor: decodeCursor(first.nextCursor),
    });
    expect(second.items.map((item) => item.id)).not.toEqual(
      first.items.map((item) => item.id),
    );
    expect([...first.items, ...second.items].map((item) => item.title)).toEqual(
      ["Evening recap", "Morning briefing", "SQLite tricks", "No date item"],
    );
    expect(second.nextCursor).toBeNull();
  });

  it("searches article text through FTS5", () => {
    const { items } = listArticles({ db, search: "FTS5" });
    expect(items.map((item) => item.title)).toEqual(["SQLite tricks"]);
  });
});

describe("cursors", () => {
  it("round-trips", () => {
    const cursor = { sortKey: 1_741_000_000_000, id: 42 };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("rejects garbage", () => {
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("nope")).toBeNull();
    expect(decodeCursor("1_nope")).toBeNull();
  });
});

describe("getArticle", () => {
  it("joins feed metadata", () => {
    const listed = listArticles({ db, feedId: techId, filter: "starred" });
    const id = listed.items[0]?.id;
    expect(id).toBeDefined();
    const article = getArticle(id as number, db);
    expect(article?.feedTitle).toBe("Tech");
    expect(article?.content).toContain("FTS5");
  });

  it("returns null for a missing id", () => {
    expect(getArticle(999_999, db)).toBeNull();
  });
});

describe("listFolders", () => {
  it("returns distinct folder names", () => {
    db.insert(feeds)
      .values({
        feedUrl: "https://other.example/feed.xml",
        title: "Other",
        folder: "Weekend",
      })
      .run();
    expect(listFolders(db)).toEqual(["Daily", "Weekend"]);
  });
});
