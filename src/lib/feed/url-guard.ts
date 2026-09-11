import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

function ipv4ToBytes(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => Number.parseInt(part, 10));
  return bytes.every(
    (byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255,
  )
    ? bytes
    : null;
}

function isPrivateIpv4(bytes: number[]): boolean {
  const [a, b] = bytes;
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // RFC 1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, covers cloud metadata at 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function ipv6ToBytes(address: string): number[] | null {
  const zoneless = address.split("%")[0];
  const [head, tail] = zoneless.split("::");
  const parse = (section: string): string[] =>
    section.length === 0
      ? []
      : section.split(":").filter((group) => group.length > 0);

  const headGroups = parse(head ?? "");
  const tailGroups = parse(tail ?? "");

  // An embedded IPv4 literal (::ffff:127.0.0.1) occupies the final two groups.
  const trailingV4 =
    tailGroups.length > 0 ? tailGroups.at(-1) : headGroups.at(-1);
  let embedded: number[] | null = null;
  if (trailingV4?.includes(".")) {
    embedded = ipv4ToBytes(trailingV4);
    if (!embedded) return null;
    if (tailGroups.length > 0) tailGroups.pop();
    else headGroups.pop();
  }

  const groupsToBytes = (groups: string[]): number[] | null => {
    const bytes: number[] = [];
    for (const group of groups) {
      const value = Number.parseInt(group, 16);
      if (!Number.isInteger(value) || value < 0 || value > 0xffff) return null;
      bytes.push(value >> 8, value & 0xff);
    }
    return bytes;
  };

  const headBytes = groupsToBytes(headGroups);
  const tailBytes = groupsToBytes(tailGroups);
  if (!headBytes || !tailBytes) return null;

  const known = headBytes.length + tailBytes.length + (embedded ? 4 : 0);
  if (known > 16) return null;
  if (!zoneless.includes("::") && known !== 16) return null;

  return [
    ...headBytes,
    ...new Array<number>(16 - known).fill(0),
    ...tailBytes,
    ...(embedded ?? []),
  ];
}

/**
 * Reports whether an address belongs to a range that a feed should never live on.
 *
 * The interesting case is cloud metadata at 169.254.169.254: without this check, pasting that
 * URL as a "feed" would make the server fetch its own credentials and store the response.
 */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const bytes = ipv4ToBytes(address);
    return bytes ? isPrivateIpv4(bytes) : true;
  }
  if (version === 6) {
    const bytes = ipv6ToBytes(address);
    if (!bytes) return true;

    // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::/96) both tunnel a v4 address, so judge
    // them by the address they actually reach.
    const isV4Mapped =
      bytes.slice(0, 10).every((byte) => byte === 0) &&
      bytes[10] === 0xff &&
      bytes[11] === 0xff;
    const isNat64 =
      bytes[0] === 0x00 &&
      bytes[1] === 0x64 &&
      bytes[2] === 0xff &&
      bytes[3] === 0x9b &&
      bytes.slice(4, 12).every((byte) => byte === 0);
    if (isV4Mapped || isNat64) return isPrivateIpv4(bytes.slice(12, 16));

    if (bytes.every((byte) => byte === 0)) return true; // ::
    if (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1)
      return true; // ::1
    if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique local
    if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10 link local
    if (bytes[0] === 0xff) return true; // multicast
    return false;
  }
  return true;
}

/** Set to `true` to allow feeds on a LAN or on localhost, e.g. when self-hosting behind a proxy. */
const ALLOW_PRIVATE = process.env.CURRENTS_ALLOW_PRIVATE_HOSTS === "true";

/**
 * Validates a user-supplied feed URL before the server fetches it.
 *
 * Feed URLs are the one place a reader takes an address from a user and makes its own server
 * request to it, which is textbook SSRF. Hostnames are resolved and every returned address is
 * checked, since a public name can legitimately point at 127.0.0.1.
 */
export async function assertSafeFeedUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError("that does not look like a valid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError(
      `unsupported protocol "${url.protocol}"; use http or https`,
    );
  }

  if (ALLOW_PRIVATE) return url;

  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new UnsafeUrlError(
        "that address is on a private or reserved network",
      );
    }
    return url;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new UnsafeUrlError(`could not resolve "${hostname}"`);
  }

  if (addresses.length === 0) {
    throw new UnsafeUrlError(`could not resolve "${hostname}"`);
  }

  // Any private answer disqualifies the host. A partially-private result set is far more likely
  // to be a rebinding attempt than a legitimately mixed deployment.
  if (addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new UnsafeUrlError(
      `"${hostname}" resolves to a private or reserved address`,
    );
  }

  return url;
}
