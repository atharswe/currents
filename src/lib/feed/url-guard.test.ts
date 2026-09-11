import { describe, expect, it } from "vitest";
import {
  assertSafeFeedUrl,
  isPrivateAddress,
  UnsafeUrlError,
} from "./url-guard";

describe("isPrivateAddress / IPv4", () => {
  const cases: [string, boolean][] = [
    ["127.0.0.1", true],
    ["10.1.2.3", true],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["192.168.1.1", true],
    ["169.254.169.254", true],
    ["100.64.0.1", true],
    ["0.0.0.0", true],
    ["224.0.0.1", true],
    ["255.255.255.255", true],
    // Just outside the RFC 1918 second-octet windows.
    ["172.15.0.1", false],
    ["172.32.0.1", false],
    ["8.8.8.8", false],
    ["1.1.1.1", false],
    ["93.184.216.34", false],
  ];

  for (const [address, expected] of cases) {
    it(`${expected ? "blocks" : "allows"} ${address}`, () => {
      expect(isPrivateAddress(address)).toBe(expected);
    });
  }
});

describe("isPrivateAddress / IPv6", () => {
  const cases: [string, boolean][] = [
    ["::1", true],
    ["::", true],
    ["fc00::1", true],
    ["fd12:3456::1", true],
    ["fe80::1", true],
    ["ff02::1", true],
    // IPv4-mapped and NAT64 forms must be judged by the v4 address they reach.
    ["::ffff:127.0.0.1", true],
    ["::ffff:192.168.0.1", true],
    ["64:ff9b::169.254.169.254", true],
    ["::ffff:8.8.8.8", false],
    ["2606:4700:4700::1111", false],
    ["2001:4860:4860::8888", false],
  ];

  for (const [address, expected] of cases) {
    it(`${expected ? "blocks" : "allows"} ${address}`, () => {
      expect(isPrivateAddress(address)).toBe(expected);
    });
  }
});

describe("isPrivateAddress / junk input", () => {
  it("blocks values that are not addresses at all", () => {
    expect(isPrivateAddress("not-an-ip")).toBe(true);
    expect(isPrivateAddress("")).toBe(true);
    expect(isPrivateAddress("999.1.1.1")).toBe(true);
  });
});

describe("assertSafeFeedUrl", () => {
  it("rejects non-http protocols", async () => {
    await expect(assertSafeFeedUrl("file:///etc/passwd")).rejects.toThrow(
      UnsafeUrlError,
    );
    await expect(assertSafeFeedUrl("javascript:alert(1)")).rejects.toThrow(
      UnsafeUrlError,
    );
    await expect(assertSafeFeedUrl("gopher://example.com")).rejects.toThrow(
      UnsafeUrlError,
    );
  });

  it("rejects unparseable input", async () => {
    await expect(assertSafeFeedUrl("not a url")).rejects.toThrow(
      UnsafeUrlError,
    );
  });

  it("rejects literal private addresses without needing DNS", async () => {
    await expect(
      assertSafeFeedUrl("http://127.0.0.1:8080/feed.xml"),
    ).rejects.toThrow(/private or reserved/);
    await expect(
      assertSafeFeedUrl("http://169.254.169.254/latest/meta-data/"),
    ).rejects.toThrow(/private or reserved/);
    await expect(assertSafeFeedUrl("http://[::1]/feed.xml")).rejects.toThrow(
      /private or reserved/,
    );
  });

  it("rejects hostnames that cannot be resolved", async () => {
    await expect(
      assertSafeFeedUrl("http://this-host-should-not-exist.invalid/feed.xml"),
    ).rejects.toThrow(/could not resolve/);
  });

  it("accepts a public literal address", async () => {
    const url = await assertSafeFeedUrl("https://1.1.1.1/feed.xml");
    expect(url.hostname).toBe("1.1.1.1");
  });
});
