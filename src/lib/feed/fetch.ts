import { assertSafeFeedUrl } from "./url-guard";

export const USER_AGENT =
  "Currents/0.1 (+https://github.com/atharswe/currents)";
const REQUEST_TIMEOUT_MS = 15_000;
/** Feeds are text. Anything past this is a misconfigured endpoint, not a feed worth reading. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export class FeedFetchError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "FeedFetchError";
    this.status = status;
  }
}

export type FetchResult =
  | { status: "not-modified" }
  | {
      status: "ok";
      body: string;
      /** URL after redirects; relative links in the document resolve against this. */
      finalUrl: string;
      etag: string | null;
      lastModified: string | null;
      contentType: string | null;
    };

export type ConditionalHeaders = {
  etag?: string | null;
  lastModified?: string | null;
};

/**
 * Reads a response body while enforcing a hard byte cap.
 *
 * `Content-Length` is a hint from the server and can be absent or a lie, so the limit is
 * enforced while streaming and the request is aborted the moment it is exceeded.
 */
async function readCappedText(response: Response): Promise<string> {
  const body = response.body;
  if (!body) return "";

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new FeedFetchError(
          `feed is larger than ${Math.round(MAX_BODY_BYTES / 1024 / 1024)}MB`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(merged);
}

/**
 * Fetches a feed document, sending conditional-GET headers when we have them.
 *
 * A 304 response means nothing changed since the last poll, which is the cheap path we want to
 * hit most of the time: no body transferred and no parsing work.
 */
export async function fetchFeed(
  feedUrl: string,
  conditional: ConditionalHeaders = {},
): Promise<FetchResult> {
  const safeUrl = await assertSafeFeedUrl(feedUrl);

  const headers = new Headers({
    "user-agent": USER_AGENT,
    accept:
      "application/atom+xml, application/rss+xml, application/xml, text/xml, */*;q=0.1",
    "accept-encoding": "gzip, deflate, br",
  });
  if (conditional.etag) headers.set("if-none-match", conditional.etag);
  if (conditional.lastModified)
    headers.set("if-modified-since", conditional.lastModified);

  let response: Response;
  try {
    response = await fetch(safeUrl, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new FeedFetchError(
        `no response within ${REQUEST_TIMEOUT_MS / 1000}s`,
      );
    }
    throw new FeedFetchError(
      `could not reach the server: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  if (response.status === 304) return { status: "not-modified" };

  if (!response.ok) {
    throw new FeedFetchError(
      `server responded ${response.status} ${response.statusText}`.trimEnd(),
      response.status,
    );
  }

  return {
    status: "ok",
    body: await readCappedText(response),
    finalUrl: response.url || safeUrl.toString(),
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
    contentType: response.headers.get("content-type"),
  };
}

const FEED_MIME_TYPES = [
  "application/rss+xml",
  "application/atom+xml",
  "application/rdf+xml",
  "application/feed+json",
];

/**
 * Extracts feed URLs advertised by an HTML page's `<link rel="alternate">` tags.
 *
 * This is what lets someone paste a blog's homepage instead of hunting for its feed URL.
 * Parsing HTML with a regex is normally a mistake, but the target is a single well-known tag
 * shape in `<head>`, and a wrong answer here just means we fail to auto-discover.
 */
export function discoverFeedUrls(html: string, baseUrl: string): string[] {
  const found: string[] = [];

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/\brel\s*=\s*["']?[^"'>]*alternate/i.test(tag)) continue;

    const typeMatch = tag.match(/\btype\s*=\s*["']([^"']+)["']/i);
    const type = typeMatch?.[1]?.trim().toLowerCase();
    if (!type || !FEED_MIME_TYPES.includes(type)) continue;

    const hrefMatch = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    const href = hrefMatch?.[1]?.trim();
    if (!href) continue;

    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:")
        continue;
      const normalized = resolved.toString();
      if (!found.includes(normalized)) found.push(normalized);
    } catch {
      // Unparseable href; skip it.
    }
  }

  return found;
}

/** True when a response looks like a web page rather than a feed document. */
export function looksLikeHtml(
  body: string,
  contentType: string | null,
): boolean {
  if (contentType?.toLowerCase().includes("html")) return true;
  const head = body.slice(0, 1000).toLowerCase();
  return head.includes("<!doctype html") || head.includes("<html");
}
