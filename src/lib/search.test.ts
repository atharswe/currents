import { describe, expect, it } from "vitest";
import { toFtsQuery } from "./search";

describe("toFtsQuery", () => {
  it("returns null for empty or whitespace input", () => {
    expect(toFtsQuery("")).toBeNull();
    expect(toFtsQuery("   \t ")).toBeNull();
  });

  it("returns null when input has no searchable characters", () => {
    expect(toFtsQuery('""')).toBeNull();
    expect(toFtsQuery('"   "')).toBeNull();
  });

  it("quotes a single term and adds a prefix wildcard", () => {
    expect(toFtsQuery("sqlite")).toBe('"sqlite"*');
  });

  it("only wildcards the final term", () => {
    expect(toFtsQuery("sqlite full text")).toBe('"sqlite" "full" "text"*');
  });

  it("skips the wildcard on a single-character term", () => {
    expect(toFtsQuery("a")).toBe('"a"');
  });

  it("neutralizes FTS operators that would otherwise change the query", () => {
    expect(toFtsQuery("cats OR dogs")).toBe('"cats" "OR" "dogs"*');
    expect(toFtsQuery("NOT ready")).toBe('"NOT" "ready"*');
  });

  it("survives characters that are FTS syntax errors when unquoted", () => {
    expect(toFtsQuery("C++")).toBe('"C++"*');
    expect(toFtsQuery("title:foo")).toBe('"title:foo"*');
    expect(toFtsQuery("^start")).toBe('"^start"*');
    expect(toFtsQuery("well-known")).toBe('"well-known"*');
  });

  it("preserves a quoted phrase as a phrase search without a wildcard", () => {
    expect(toFtsQuery('"exact phrase"')).toBe('"exact phrase"');
  });

  it("mixes phrases and loose words", () => {
    expect(toFtsQuery('"rate limiting" nginx')).toBe('"rate limiting" "nginx"*');
  });

  it("recovers from an unbalanced quote", () => {
    expect(toFtsQuery('"hello')).toBe('"hello"*');
  });

  it("escapes embedded quotes by doubling them", () => {
    expect(toFtsQuery('say "hi" now')).toBe('"say" "hi" "now"*');
  });

  it("collapses extra whitespace between terms", () => {
    expect(toFtsQuery("  spaced   out  ")).toBe('"spaced" "out"*');
  });
});
