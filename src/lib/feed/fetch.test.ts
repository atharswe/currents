import { describe, expect, it } from "vitest";
import { discoverFeedUrls, looksLikeHtml } from "./fetch";

const BASE = "https://blog.example.com/";

describe("discoverFeedUrls", () => {
  it("finds an RSS link in head", () => {
    const html = `<html><head>
      <link rel="alternate" type="application/rss+xml" title="RSS" href="/feed.xml">
    </head></html>`;
    expect(discoverFeedUrls(html, BASE)).toEqual([
      "https://blog.example.com/feed.xml",
    ]);
  });

  it("finds Atom and RSS links in document order", () => {
    const html = `<head>
      <link rel="alternate" type="application/atom+xml" href="/atom.xml">
      <link rel="alternate" type="application/rss+xml" href="/rss.xml">
    </head>`;
    expect(discoverFeedUrls(html, BASE)).toEqual([
      "https://blog.example.com/atom.xml",
      "https://blog.example.com/rss.xml",
    ]);
  });

  it("ignores stylesheets and icons", () => {
    const html = `<head>
      <link rel="stylesheet" href="/app.css">
      <link rel="icon" href="/favicon.ico">
      <link rel="canonical" href="https://blog.example.com/">
    </head>`;
    expect(discoverFeedUrls(html, BASE)).toEqual([]);
  });

  it("ignores alternate links that are not feeds, such as hreflang variants", () => {
    const html = `<head>
      <link rel="alternate" hreflang="fr" href="https://blog.example.com/fr">
      <link rel="alternate" type="text/html" href="https://blog.example.com/amp">
    </head>`;
    expect(discoverFeedUrls(html, BASE)).toEqual([]);
  });

  it("handles absolute hrefs and unquoted rel values", () => {
    const html = `<link rel=alternate type="application/rss+xml" href="https://cdn.example.net/f.xml">`;
    expect(discoverFeedUrls(html, BASE)).toEqual([
      "https://cdn.example.net/f.xml",
    ]);
  });

  it("deduplicates repeated links", () => {
    const html = `
      <link rel="alternate" type="application/rss+xml" href="/feed.xml">
      <link rel="alternate" type="application/rss+xml" href="/feed.xml">`;
    expect(discoverFeedUrls(html, BASE)).toEqual([
      "https://blog.example.com/feed.xml",
    ]);
  });

  it("skips non-http schemes", () => {
    const html = `<link rel="alternate" type="application/rss+xml" href="javascript:alert(1)">`;
    expect(discoverFeedUrls(html, BASE)).toEqual([]);
  });

  it("returns nothing for a page with no links", () => {
    expect(discoverFeedUrls("<html><body>hello</body></html>", BASE)).toEqual(
      [],
    );
  });
});

describe("looksLikeHtml", () => {
  it("trusts an html content type", () => {
    expect(looksLikeHtml("<rss></rss>", "text/html; charset=utf-8")).toBe(true);
  });

  it("detects a doctype when the content type is unhelpful", () => {
    expect(
      looksLikeHtml("<!DOCTYPE html><html>", "application/octet-stream"),
    ).toBe(true);
  });

  it("does not flag a feed served as xml", () => {
    expect(
      looksLikeHtml('<?xml version="1.0"?><rss></rss>', "application/rss+xml"),
    ).toBe(false);
  });

  it("does not flag a feed with a missing content type", () => {
    expect(looksLikeHtml('<?xml version="1.0"?><feed></feed>', null)).toBe(
      false,
    );
  });
});
