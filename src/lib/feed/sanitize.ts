import sanitizeHtml from "sanitize-html";

/**
 * Everything in a feed is attacker-controlled text from a third party, so article bodies are
 * rendered through an allowlist rather than escaped-and-hoped-for-the-best.
 */
const ARTICLE_POLICY: sanitizeHtml.IOptions = {
  allowedTags: [
    "a",
    "abbr",
    "blockquote",
    "br",
    "caption",
    "cite",
    "code",
    "dd",
    "del",
    "dl",
    "dt",
    "em",
    "figcaption",
    "figure",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "i",
    "img",
    "ins",
    "kbd",
    "li",
    "ol",
    "p",
    "pre",
    "q",
    "s",
    "samp",
    "small",
    "span",
    "strong",
    "sub",
    "sup",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "tr",
    "ul",
    "var",
  ],
  allowedAttributes: {
    // target and rel are not in the source markup; they are added by transformTags below and
    // still have to be allowed here or they would be stripped straight back out.
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title", "width", "height", "loading"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan", "scope"],
  },
  // No `data:` anywhere: it is the usual way a payload smuggles script into an href.
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https"] },
  allowProtocolRelative: false,
  // Drop the contents of these outright rather than unwrapping them as text.
  nonTextTags: ["style", "script", "textarea", "option", "noscript"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", {
      target: "_blank",
      rel: "noopener noreferrer nofollow",
    }),
    img: sanitizeHtml.simpleTransform("img", { loading: "lazy" }),
  },
  // Rejecting a disallowed scheme only strips the attribute, which would leave a broken
  // <img> behind. Drop the element too.
  exclusiveFilter: (frame) => frame.tag === "img" && !frame.attribs.src,
};

/** Sanitizes a feed-supplied article body for rendering. */
export function sanitizeArticleHtml(html: string): string {
  return sanitizeHtml(html, ARTICLE_POLICY);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "\u2026",
  mdash: "\u2014",
  ndash: "\u2013",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
};

function decodeEntities(input: string): string {
  return input.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (match, body: string) => {
      if (body.startsWith("#")) {
        const codePoint =
          body[1]?.toLowerCase() === "x"
            ? Number.parseInt(body.slice(2), 16)
            : Number.parseInt(body.slice(1), 10);
        if (
          !Number.isFinite(codePoint) ||
          codePoint <= 0 ||
          codePoint > 0x10ffff
        ) {
          return match;
        }
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return match;
        }
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? match;
    },
  );
}

/**
 * Flattens HTML to a single line of readable text, for list excerpts and search snippets.
 *
 * Block-level tags become spaces first so `<p>a</p><p>b</p>` does not read as "ab".
 */
export function htmlToText(html: string): string {
  const spaced = html.replace(
    /<\/?(p|div|br|li|tr|h[1-6]|blockquote|pre)\b[^>]*>/gi,
    " ",
  );
  const stripped = sanitizeHtml(spaced, {
    allowedTags: [],
    allowedAttributes: {},
  });
  return decodeEntities(stripped).replace(/\s+/g, " ").trim();
}

/** Truncates at a word boundary and appends an ellipsis when text was actually removed. */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const clipped = text.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${(lastSpace > maxLength * 0.6 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}\u2026`;
}
