import { describe, expect, it } from "vitest";
import { FeedParseError, parseFeed } from "./parse";

const BASE = "https://example.com/feed.xml";

describe("parseFeed / RSS 2.0", () => {
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"
     xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Example Blog</title>
    <link>https://example.com</link>
    <description>Notes on things</description>
    <item>
      <title>First post</title>
      <link>https://example.com/first</link>
      <guid isPermaLink="false">tag:example.com,2026:1</guid>
      <pubDate>Tue, 03 Mar 2026 09:30:00 GMT</pubDate>
      <dc:creator>Ada Lovelace</dc:creator>
      <description>A short teaser.</description>
      <content:encoded><![CDATA[<p>Full <em>body</em> here.</p>]]></content:encoded>
    </item>
    <item>
      <title>Second post</title>
      <link>/second</link>
      <description><![CDATA[<p>Relative link test &amp; entities.</p>]]></description>
    </item>
  </channel>
</rss>`;

  it("reads channel metadata", () => {
    const feed = parseFeed(rss, BASE);
    expect(feed.title).toBe("Example Blog");
    expect(feed.siteUrl).toBe("https://example.com/");
    expect(feed.description).toBe("Notes on things");
    expect(feed.items).toHaveLength(2);
  });

  it("prefers content:encoded over description for the body", () => {
    const [first] = parseFeed(rss, BASE).items;
    expect(first.content).toBe("<p>Full <em>body</em> here.</p>");
    expect(first.summary).toBe("A short teaser.");
  });

  it("keeps the guid element text rather than its attributes", () => {
    const [first] = parseFeed(rss, BASE).items;
    expect(first.guid).toBe("tag:example.com,2026:1");
  });

  it("reads dc:creator despite the namespace prefix", () => {
    const [first] = parseFeed(rss, BASE).items;
    expect(first.author).toBe("Ada Lovelace");
  });

  it("parses RFC-822 dates", () => {
    const [first] = parseFeed(rss, BASE).items;
    expect(first.publishedAt?.toISOString()).toBe("2026-03-03T09:30:00.000Z");
  });

  it("absolutizes relative links against the feed url", () => {
    const [, second] = parseFeed(rss, BASE).items;
    expect(second.url).toBe("https://example.com/second");
  });

  it("falls back to the link when no guid is present", () => {
    const [, second] = parseFeed(rss, BASE).items;
    expect(second.guid).toBe("https://example.com/second");
  });

  it("decodes entities when flattening html to a summary", () => {
    const [, second] = parseFeed(rss, BASE).items;
    expect(second.summary).toBe("Relative link test & entities.");
  });

  it("leaves publishedAt null when the item has no date", () => {
    const [, second] = parseFeed(rss, BASE).items;
    expect(second.publishedAt).toBeNull();
  });
});

describe("parseFeed / Atom", () => {
  const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="text">Atom Journal</title>
  <subtitle>Subtitle here</subtitle>
  <link rel="self" href="https://example.com/atom.xml"/>
  <link rel="alternate" type="text/html" href="https://example.com/blog"/>
  <entry>
    <title>Atom entry</title>
    <id>urn:uuid:1225c695-cfb8-4ebb-aaaa-80da344efa6a</id>
    <link rel="edit" href="https://example.com/edit/1"/>
    <link href="https://example.com/entry/1"/>
    <published>2026-02-01T12:00:00Z</published>
    <updated>2026-02-02T12:00:00Z</updated>
    <author><name>Grace Hopper</name></author>
    <summary type="html">&lt;p&gt;Summary text&lt;/p&gt;</summary>
    <content type="html">&lt;p&gt;Body text&lt;/p&gt;</content>
  </entry>
</feed>`;

  it("ignores rel=self when choosing the site url", () => {
    const feed = parseFeed(atom, BASE);
    expect(feed.siteUrl).toBe("https://example.com/blog");
  });

  it("reads a title carrying a type attribute", () => {
    expect(parseFeed(atom, BASE).title).toBe("Atom Journal");
  });

  it("uses subtitle as the description", () => {
    expect(parseFeed(atom, BASE).description).toBe("Subtitle here");
  });

  it("prefers the alternate entry link over rel=edit", () => {
    const [entry] = parseFeed(atom, BASE).items;
    expect(entry.url).toBe("https://example.com/entry/1");
  });

  it("prefers published over updated", () => {
    const [entry] = parseFeed(atom, BASE).items;
    expect(entry.publishedAt?.toISOString()).toBe("2026-02-01T12:00:00.000Z");
  });

  it("reads the nested author name", () => {
    const [entry] = parseFeed(atom, BASE).items;
    expect(entry.author).toBe("Grace Hopper");
  });

  it("uses id as the guid", () => {
    const [entry] = parseFeed(atom, BASE).items;
    expect(entry.guid).toBe("urn:uuid:1225c695-cfb8-4ebb-aaaa-80da344efa6a");
  });

  it("keeps escaped html in content as markup", () => {
    const [entry] = parseFeed(atom, BASE).items;
    expect(entry.content).toBe("<p>Body text</p>");
    expect(entry.summary).toBe("Summary text");
  });
});

describe("parseFeed / RSS 1.0 RDF", () => {
  const rdf = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns="http://purl.org/rss/1.0/"
         xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://example.com/rdf">
    <title>RDF Feed</title>
    <link>https://example.com</link>
    <description>Old school</description>
  </channel>
  <item rdf:about="https://example.com/rdf/1">
    <title>RDF item</title>
    <link>https://example.com/rdf/1</link>
    <dc:date>2026-01-15T08:00:00Z</dc:date>
    <description>RDF description</description>
  </item>
</rdf:RDF>`;

  it("finds items that are siblings of channel", () => {
    const feed = parseFeed(rdf, BASE);
    expect(feed.title).toBe("RDF Feed");
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].title).toBe("RDF item");
  });

  it("reads dc:date", () => {
    const [item] = parseFeed(rdf, BASE).items;
    expect(item.publishedAt?.toISOString()).toBe("2026-01-15T08:00:00.000Z");
  });
});

describe("parseFeed / robustness", () => {
  it("handles a single item without treating it as a character array", () => {
    const feed = parseFeed(
      `<rss version="2.0"><channel><title>One</title>
        <item><title>Only</title><link>https://example.com/only</link></item>
      </channel></rss>`,
      BASE,
    );
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].title).toBe("Only");
  });

  it("returns an empty item list for an empty channel", () => {
    const feed = parseFeed(
      `<rss version="2.0"><channel><title>Empty</title></channel></rss>`,
      BASE,
    );
    expect(feed.items).toEqual([]);
  });

  it("synthesizes a stable guid when neither guid nor link exists", () => {
    const xml = `<rss version="2.0"><channel><title>T</title>
      <item><title>No identity</title><pubDate>Tue, 03 Mar 2026 09:30:00 GMT</pubDate></item>
    </channel></rss>`;
    const first = parseFeed(xml, BASE).items[0].guid;
    const second = parseFeed(xml, BASE).items[0].guid;
    expect(first).toMatch(/^currents:synthetic:/);
    expect(second).toBe(first);
  });

  it("rejects non-feed xml", () => {
    expect(() => parseFeed("<html><body>hi</body></html>", BASE)).toThrow(
      FeedParseError,
    );
  });

  it("rejects a truncated document rather than importing a partial item list", () => {
    expect(() =>
      parseFeed(
        `<rss version="2.0"><channel><title>T</title>
          <item><title>Kept</title></item>`,
        BASE,
      ),
    ).toThrow(FeedParseError);
  });

  it("rejects a truncated atom document", () => {
    expect(() =>
      parseFeed(
        '<feed xmlns="http://www.w3.org/2005/Atom"><title>T</title><entry>',
        BASE,
      ),
    ).toThrow(FeedParseError);
  });

  it("tolerates unescaped ampersands, which are common in real feeds", () => {
    const feed = parseFeed(
      `<rss version="2.0"><channel><title>Tom & Jerry</title>
        <item><title>Salt & pepper</title><link>https://example.com/1</link></item>
      </channel></rss>`,
      BASE,
    );
    expect(feed.title).toContain("Tom");
    expect(feed.items).toHaveLength(1);
  });

  it("drops javascript: links instead of absolutizing them", () => {
    const feed = parseFeed(
      `<rss version="2.0"><channel><title>T</title>
        <item><title>Bad link</title><link>javascript:alert(1)</link></item>
      </channel></rss>`,
      BASE,
    );
    expect(feed.items[0].url).toBeNull();
  });
});
