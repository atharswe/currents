import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { htmlToText, sanitizeArticleHtml, truncate } from "./sanitize";

export type ParsedItem = {
  /** Stable per-feed identifier used to recognise an item we already stored. */
  guid: string;
  url: string | null;
  title: string;
  author: string | null;
  /** Plain-text excerpt for list rows. */
  summary: string | null;
  /** Sanitized HTML body, present only when the feed ships one. */
  content: string | null;
  publishedAt: Date | null;
};

export type ParsedFeed = {
  title: string;
  siteUrl: string | null;
  description: string | null;
  items: ParsedItem[];
};

export class FeedParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedParseError";
  }
}

export const SUMMARY_MAX_LENGTH = 400;

// biome-ignore lint/suspicious/noExplicitAny: parsed XML is genuinely unshaped until narrowed.
type XmlNode = any;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Feeds disagree wildly about namespace prefixes (`content:encoded`, `dc:creator`, `atom:link`).
  // Stripping them lets one set of lookups cover every dialect.
  removeNSPrefix: true,
  trimValues: true,
  // Keep everything a string: version="2.0" becoming the number 2 has bitten enough parsers.
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  cdataPropName: "#cdata",
});

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Pulls text out of a node that may be a bare string, a `{ '#text': ... }` wrapper when the
 * element carried attributes, or a CDATA section.
 */
function text(node: XmlNode): string | null {
  if (node === undefined || node === null) return null;
  if (typeof node === "string") return node.trim() || null;
  if (typeof node === "number" || typeof node === "boolean")
    return String(node);
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = text(entry);
      if (found) return found;
    }
    return null;
  }
  if (typeof node === "object") {
    const cdata = node["#cdata"];
    if (cdata !== undefined) return text(cdata);
    const inner = node["#text"];
    if (inner !== undefined) return text(inner);
  }
  return null;
}

function resolveUrl(href: string | null, baseUrl: string): string | null {
  if (!href) return null;
  try {
    const resolved = new URL(href, baseUrl);
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? resolved.toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * Picks the human-facing link from an Atom `<link>` set.
 *
 * Atom uses the same element for the article, the feed itself (`rel="self"`), pagination, and
 * enclosures, so the rel attribute decides. `rel` is optional and defaults to `alternate`.
 */
function atomLink(node: XmlNode, baseUrl: string): string | null {
  const links = toArray<XmlNode>(node);
  const candidates = links.filter(
    (link) => typeof link === "object" && link !== null,
  );

  const alternate = candidates.find((link) => {
    const rel = link["@_rel"];
    return (rel === undefined || rel === "alternate") && link["@_href"];
  });
  if (alternate) return resolveUrl(String(alternate["@_href"]), baseUrl);

  const anyHref = candidates.find(
    (link) => link["@_href"] && link["@_rel"] !== "self",
  );
  if (anyHref) return resolveUrl(String(anyHref["@_href"]), baseUrl);

  // RSS-style `<link>text</link>` inside an otherwise Atom document.
  return resolveUrl(text(node), baseUrl);
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  // Some feeds emit RFC-822 with a bare numeric offset or a stray weekday; retry without it.
  const withoutWeekday = value.replace(/^[A-Za-z]{3},\s*/, "");
  const retry = new Date(withoutWeekday);
  return Number.isNaN(retry.getTime()) ? null : retry;
}

function authorOf(node: XmlNode): string | null {
  // Atom nests a name; RSS 2.0 uses a bare email-ish string; dc:creator is the common extension.
  for (const candidate of toArray<XmlNode>(node)) {
    if (
      candidate &&
      typeof candidate === "object" &&
      candidate.name !== undefined
    ) {
      const name = text(candidate.name);
      if (name) return name;
    }
    const flat = text(candidate);
    if (flat) return flat;
  }
  return null;
}

/**
 * Builds a fallback identifier for feeds that ship neither a guid nor a link.
 *
 * Hashing title plus date keeps it stable across polls, which is the whole point: a random id
 * would re-insert the same item on every refresh.
 */
function syntheticGuid(title: string, publishedAt: Date | null): string {
  const hash = createHash("sha256");
  hash.update(title);
  hash.update(publishedAt ? String(publishedAt.getTime()) : "");
  return `currents:synthetic:${hash.digest("hex").slice(0, 32)}`;
}

function buildItem(
  raw: XmlNode,
  baseUrl: string,
  dialect: "rss" | "atom",
): ParsedItem | null {
  if (!raw || typeof raw !== "object") return null;

  const publishedAt = parseDate(
    text(raw.pubDate) ??
      text(raw.published) ??
      text(raw.updated) ??
      text(raw.date),
  );

  const url =
    dialect === "atom"
      ? atomLink(raw.link, baseUrl)
      : (resolveUrl(text(raw.link), baseUrl) ??
        resolveUrl(text(raw.origLink), baseUrl) ??
        atomLink(raw.link, baseUrl));

  const title = text(raw.title);

  // `content:encoded` (namespace-stripped to `encoded`) is where most RSS feeds put full text.
  const bodyHtml =
    text(raw.encoded) ?? text(raw.content) ?? text(raw.description) ?? null;
  const summaryHtml = text(raw.summary) ?? text(raw.description) ?? bodyHtml;

  // A guid element can be `{ '@_isPermaLink': 'false', '#text': '...' }`, hence text() not raw.
  const guid = text(raw.guid) ?? text(raw.id) ?? text(raw["@_about"]) ?? url;

  const resolvedTitle = title ?? (url ? url : null);
  if (!resolvedTitle && !bodyHtml) return null;

  const finalTitle = resolvedTitle ?? "(untitled)";
  const summaryText = summaryHtml ? htmlToText(summaryHtml) : null;

  return {
    guid: guid ?? syntheticGuid(finalTitle, publishedAt),
    url,
    title: htmlToText(finalTitle) || finalTitle,
    author: authorOf(raw.author ?? raw.creator),
    summary: summaryText ? truncate(summaryText, SUMMARY_MAX_LENGTH) : null,
    content: bodyHtml ? sanitizeArticleHtml(bodyHtml) : null,
    publishedAt,
  };
}

/**
 * Rejects documents that are missing their closing root tag.
 *
 * Deliberately narrow: feeds in the wild are full of sloppy markup (unescaped ampersands being
 * the classic), and a strict XML validator would refuse plenty of feeds that parse fine. A
 * truncated document is different, because it silently yields a *subset* of articles — the
 * reader would look like it worked and quietly lose entries.
 */
function assertNotTruncated(xml: string, rootTag: string): void {
  if (
    !new RegExp(`</\\s*(?:[\\w.-]+:)?${rootTag}\\s*>\\s*$`, "i").test(
      xml.trimEnd(),
    )
  ) {
    throw new FeedParseError(
      `document ends without a closing <${rootTag}> tag, so the response was likely truncated`,
    );
  }
}

/**
 * Parses an RSS 2.0, RSS 1.0/RDF, or Atom document.
 *
 * `baseUrl` is the address the document was fetched from, used to absolutize relative links.
 */
export function parseFeed(xml: string, baseUrl: string): ParsedFeed {
  let document: XmlNode;
  try {
    document = parser.parse(xml);
  } catch (error) {
    throw new FeedParseError(
      `document is not well-formed XML: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }

  if (!document || typeof document !== "object") {
    throw new FeedParseError("document is empty");
  }

  if (document.feed) {
    assertNotTruncated(xml, "feed");
    const feed = document.feed;
    return {
      title: text(feed.title) ?? "Untitled feed",
      siteUrl: atomLink(feed.link, baseUrl),
      description: text(feed.subtitle) ?? text(feed.description),
      items: toArray<XmlNode>(feed.entry)
        .map((entry) => buildItem(entry, baseUrl, "atom"))
        .filter((item): item is ParsedItem => item !== null),
    };
  }

  if (document.rss?.channel) {
    assertNotTruncated(xml, "rss");
    const channel = document.rss.channel;
    return {
      title: text(channel.title) ?? "Untitled feed",
      siteUrl: resolveUrl(text(channel.link), baseUrl),
      description: text(channel.description),
      items: toArray<XmlNode>(channel.item)
        .map((item) => buildItem(item, baseUrl, "rss"))
        .filter((item): item is ParsedItem => item !== null),
    };
  }

  // RSS 1.0 keeps <item> elements as siblings of <channel>, not children of it.
  if (document.RDF) {
    assertNotTruncated(xml, "RDF");
    const rdf = document.RDF;
    const channel = rdf.channel ?? {};
    return {
      title: text(channel.title) ?? "Untitled feed",
      siteUrl: resolveUrl(text(channel.link), baseUrl),
      description: text(channel.description),
      items: toArray<XmlNode>(rdf.item)
        .map((item) => buildItem(item, baseUrl, "rss"))
        .filter((item): item is ParsedItem => item !== null),
    };
  }

  throw new FeedParseError("no <rss>, <feed>, or <rdf:RDF> root element found");
}
