import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "@/db/client";
import { articles, feeds } from "@/db/schema";
import { SubscribeError, subscribeToFeed } from "./subscribe";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example Blog</title>
    <link>https://example.com</link>
    <description>Notes on things</description>
    <item>
      <title>First post</title>
      <link>https://example.com/first</link>
      <guid>tag:example.com,2026:1</guid>
      <description>Hello from the feed.</description>
    </item>
  </channel>
</rss>`;

const HTML_WITH_FEED = `<!doctype html>
<html>
  <head>
    <link rel="alternate" type="application/rss+xml" title="RSS" href="/feed.xml">
  </head>
  <body>a blog</body>
</html>`;

function jsonHeaders(contentType: string): Headers {
  return new Headers({ "content-type": contentType });
}

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://blog.example.com/") {
        return new Response(HTML_WITH_FEED, {
          status: 200,
          headers: jsonHeaders("text/html; charset=utf-8"),
        });
      }
      if (url === "https://not-a-feed.example.com/") {
        return new Response(
          "<!doctype html><html><body>no feed here</body></html>",
          {
            status: 200,
            headers: jsonHeaders("text/html"),
          },
        );
      }
      return new Response(RSS, {
        status: 200,
        headers: jsonHeaders("application/rss+xml"),
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("subscribeToFeed", () => {
  it("stores a feed and its items from a direct feed URL", async () => {
    const result = await subscribeToFeed(db, "https://example.com/feed.xml");
    expect(result.alreadyExisted).toBe(false);
    expect(result.inserted).toBe(1);
    expect(result.title).toBe("Example Blog");
    expect(db.select().from(feeds).all()).toHaveLength(1);
    expect(db.select().from(articles).all()).toHaveLength(1);
  });

  it("discovers a feed from a homepage", async () => {
    const result = await subscribeToFeed(db, "https://blog.example.com/");
    expect(result.alreadyExisted).toBe(false);
    expect(result.feedUrl).toContain("feed.xml");
    expect(db.select().from(articles).all()).toHaveLength(1);
  });

  it("refreshes rather than duplicating an existing subscription", async () => {
    await subscribeToFeed(db, "https://example.com/feed.xml");
    const again = await subscribeToFeed(db, "https://example.com/feed.xml");
    expect(again.alreadyExisted).toBe(true);
    expect(again.inserted).toBe(0);
    expect(db.select().from(feeds).all()).toHaveLength(1);
  });

  it("honours a folder and a title override", async () => {
    const result = await subscribeToFeed(db, "https://example.com/feed.xml", {
      folder: "News",
      title: "Renamed",
    });
    const stored = db.select().from(feeds).get();
    expect(result.title).toBe("Renamed");
    expect(stored?.folder).toBe("News");
    expect(stored?.title).toBe("Renamed");
  });

  it("rejects an empty URL", async () => {
    await expect(subscribeToFeed(db, "   ")).rejects.toBeInstanceOf(
      SubscribeError,
    );
  });

  it("rejects a homepage with no advertised feed", async () => {
    await expect(
      subscribeToFeed(db, "https://not-a-feed.example.com/"),
    ).rejects.toThrow(/no RSS or Atom feed/i);
  });
});
