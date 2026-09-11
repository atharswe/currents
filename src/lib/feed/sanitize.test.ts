import { describe, expect, it } from "vitest";
import { htmlToText, sanitizeArticleHtml, truncate } from "./sanitize";

describe("sanitizeArticleHtml", () => {
  it("removes script tags and their contents", () => {
    expect(sanitizeArticleHtml('<p>ok</p><script>alert("x")</script>')).toBe(
      "<p>ok</p>",
    );
  });

  it("strips inline event handlers", () => {
    expect(sanitizeArticleHtml('<p onclick="steal()">text</p>')).toBe(
      "<p>text</p>",
    );
  });

  it("drops javascript: hrefs but keeps the link text", () => {
    const result = sanitizeArticleHtml(
      '<a href="javascript:alert(1)">click</a>',
    );
    expect(result).not.toContain("javascript:");
    expect(result).not.toContain("href");
    expect(result).toContain("click");
  });

  it("drops data: image sources", () => {
    expect(
      sanitizeArticleHtml(
        '<img src="data:text/html;base64,PHNjcmlwdD4=" alt="x">',
      ),
    ).toBe("");
  });

  it("keeps http image sources", () => {
    expect(
      sanitizeArticleHtml('<img src="https://example.com/a.png" alt="a">'),
    ).toContain('src="https://example.com/a.png"');
  });

  it("marks outbound links safe for target=_blank", () => {
    const result = sanitizeArticleHtml('<a href="https://example.com">x</a>');
    expect(result).toContain('rel="noopener noreferrer nofollow"');
    expect(result).toContain('target="_blank"');
  });

  it("keeps structural markup used by real articles", () => {
    const input =
      "<h2>Title</h2><ul><li>one</li></ul><blockquote><p>quote</p></blockquote>";
    expect(sanitizeArticleHtml(input)).toBe(input);
  });

  it("removes style blocks so feeds cannot restyle the reader", () => {
    expect(
      sanitizeArticleHtml("<style>body{display:none}</style><p>hi</p>"),
    ).toBe("<p>hi</p>");
  });

  it("strips iframes", () => {
    expect(
      sanitizeArticleHtml('<iframe src="https://evil.test"></iframe><p>hi</p>'),
    ).toBe("<p>hi</p>");
  });
});

describe("htmlToText", () => {
  it("separates block elements with whitespace", () => {
    expect(htmlToText("<p>one</p><p>two</p>")).toBe("one two");
  });

  it("collapses runs of whitespace", () => {
    expect(htmlToText("<p>a  \n\t b</p>")).toBe("a b");
  });

  it("decodes named entities", () => {
    expect(htmlToText("<p>Tom &amp; Jerry &hellip;</p>")).toBe(
      "Tom & Jerry \u2026",
    );
  });

  it("decodes numeric and hex entities", () => {
    expect(htmlToText("<p>&#65;&#x42;</p>")).toBe("AB");
  });

  it("discards script contents rather than inlining them as text", () => {
    expect(htmlToText("<p>hi</p><script>var a = 1;</script>")).toBe("hi");
  });

  it("returns an empty string for markup with no text", () => {
    expect(htmlToText("<div><br/></div>")).toBe("");
  });
});

describe("truncate", () => {
  it("leaves short text untouched", () => {
    expect(truncate("short", 20)).toBe("short");
  });

  it("cuts at a word boundary and appends an ellipsis", () => {
    expect(truncate("the quick brown fox jumps", 16)).toBe(
      "the quick brown\u2026",
    );
  });

  it("hard-cuts when there is no usable word boundary", () => {
    expect(truncate("aaaaaaaaaaaaaaaaaaaa", 5)).toBe("aaaaa\u2026");
  });
});
