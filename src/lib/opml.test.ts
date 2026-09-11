import { describe, expect, it } from "vitest";
import { buildOpml, OpmlError, parseOpml } from "./opml";

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Subscriptions</title></head>
  <body>
    <outline text="News" title="News">
      <outline type="rss" text="HN" title="Hacker News"
               xmlUrl="https://news.ycombinator.com/rss"
               htmlUrl="https://news.ycombinator.com"/>
      <outline type="rss" text="Verge" xmlUrl="https://www.theverge.com/rss/index.xml"/>
    </outline>
    <outline type="rss" text="Standalone" xmlUrl="https://simonwillison.net/atom.xml"/>
    <outline type="rss" text="Duplicate" xmlUrl="https://news.ycombinator.com/rss"/>
    <outline type="rss" text="Bad" xmlUrl="javascript:alert(1)"/>
  </body>
</opml>`;

describe("parseOpml", () => {
  it("reads nested folders and top-level feeds", () => {
    const outlines = parseOpml(SAMPLE);
    expect(outlines).toEqual([
      {
        title: "Hacker News",
        xmlUrl: "https://news.ycombinator.com/rss",
        htmlUrl: "https://news.ycombinator.com",
        folder: "News",
      },
      {
        title: "Verge",
        xmlUrl: "https://www.theverge.com/rss/index.xml",
        htmlUrl: null,
        folder: "News",
      },
      {
        title: "Standalone",
        xmlUrl: "https://simonwillison.net/atom.xml",
        htmlUrl: null,
        folder: "Unsorted",
      },
    ]);
  });

  it("rejects documents that are not OPML", () => {
    expect(() => parseOpml("<rss></rss>")).toThrow(OpmlError);
  });
});

describe("buildOpml", () => {
  it("groups feeds by folder and round-trips", () => {
    const xml = buildOpml([
      {
        title: "HN",
        feedUrl: "https://news.ycombinator.com/rss",
        siteUrl: "https://news.ycombinator.com",
        folder: "News",
      },
      {
        title: "Solo",
        feedUrl: "https://example.com/atom.xml",
        siteUrl: null,
        folder: "Unsorted",
      },
    ]);
    const parsed = parseOpml(xml);
    expect(parsed).toHaveLength(2);
    expect(parsed.find((row) => row.title === "HN")?.folder).toBe("News");
    expect(parsed.find((row) => row.title === "Solo")?.folder).toBe("Unsorted");
  });
});
