import { XMLBuilder, XMLParser } from "fast-xml-parser";

export type OpmlOutline = {
  title: string;
  xmlUrl: string;
  htmlUrl: string | null;
  folder: string;
};

export class OpmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpmlError";
  }
}

// biome-ignore lint/suspicious/noExplicitAny: OPML is unshaped XML until we walk it.
type XmlNode = any;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
});

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function attr(node: XmlNode, name: string): string | null {
  if (!node || typeof node !== "object") return null;
  const value = node[`@_${name}`];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

/**
 * Walks nested `<outline>` elements, treating containers (no xmlUrl) as folders.
 *
 * A folder name is inherited: a feed nested under "News" lands in that folder even if the feed
 * outline itself has no category attribute.
 */
function walkOutlines(
  nodes: XmlNode[],
  folder: string,
  into: OpmlOutline[],
): void {
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const xmlUrl = attr(node, "xmlUrl");
    const title =
      attr(node, "title") ?? attr(node, "text") ?? xmlUrl ?? "Untitled";
    const nextFolder = xmlUrl
      ? folder
      : (attr(node, "title") ?? attr(node, "text") ?? folder);

    if (xmlUrl) {
      try {
        const url = new URL(xmlUrl);
        if (url.protocol === "http:" || url.protocol === "https:") {
          into.push({
            title,
            xmlUrl: url.toString(),
            htmlUrl: attr(node, "htmlUrl"),
            folder: folder || "Unsorted",
          });
        }
      } catch {
        // Skip malformed xmlUrl values rather than aborting the whole import.
      }
    }

    walkOutlines(toArray<XmlNode>(node.outline), nextFolder, into);
  }
}

/**
 * Extracts feed outlines from an OPML 1.0/2.0 document.
 *
 * Duplicate xmlUrls are collapsed, keeping the first occurrence so a messy export does not
 * subscribe the same site twice.
 */
export function parseOpml(xml: string): OpmlOutline[] {
  let document: XmlNode;
  try {
    document = parser.parse(xml);
  } catch (error) {
    throw new OpmlError(
      `OPML is not well-formed XML: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }

  const body = document?.opml?.body;
  if (!body) {
    throw new OpmlError("no <opml><body> root found");
  }

  const found: OpmlOutline[] = [];
  walkOutlines(toArray<XmlNode>(body.outline), "Unsorted", found);

  const seen = new Set<string>();
  return found.filter((outline) => {
    if (seen.has(outline.xmlUrl)) return false;
    seen.add(outline.xmlUrl);
    return true;
  });
}

export type OpmlFeed = {
  title: string;
  feedUrl: string;
  siteUrl: string | null;
  folder: string;
};

/** Serialises current subscriptions to OPML 2.0, grouped by folder. */
export function buildOpml(feeds: OpmlFeed[]): string {
  const byFolder = new Map<string, OpmlFeed[]>();
  for (const feed of feeds) {
    const folder = feed.folder || "Unsorted";
    const list = byFolder.get(folder) ?? [];
    list.push(feed);
    byFolder.set(folder, list);
  }

  const outlines = [...byFolder.entries()].map(([folder, grouped]) => ({
    "@_text": folder,
    "@_title": folder,
    outline: grouped.map((feed) => ({
      "@_type": "rss",
      "@_text": feed.title,
      "@_title": feed.title,
      "@_xmlUrl": feed.feedUrl,
      ...(feed.siteUrl ? { "@_htmlUrl": feed.siteUrl } : {}),
    })),
  }));

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    format: true,
    suppressEmptyNode: true,
  });

  return builder.build({
    "?xml": { "@_version": "1.0", "@_encoding": "UTF-8" },
    opml: {
      "@_version": "2.0",
      head: {
        title: "Currents",
        dateCreated: new Date().toUTCString(),
      },
      body: { outline: outlines },
    },
  });
}
