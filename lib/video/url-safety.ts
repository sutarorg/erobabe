/**
 * Pure URL host checks used by the SSRF guard (`assertPublicHttpUrl`) and by
 * the upload-node URL validation.
 *
 * These are *defence in depth*, not a complete SSRF solution: the actual
 * download of a remote video is performed by UFOLOAD's servers (which block
 * internal ranges themselves, per `POST /api/v1/files/import`), and a hostname
 * can still resolve to a private address (DNS rebinding) — that can only be
 * stopped where the fetch happens. What these checks do guarantee is that an
 * admin cannot paste a link that is *obviously* internal, and that nothing we
 * hand to a third party points at a literal private IP.
 *
 * `new URL()` already canonicalises numeric hosts, so `http://2130706433/`,
 * `http://0x7f.1/` and `http://127.1/` all arrive here as `127.0.0.1`.
 */

function isPrivateIpv4(host: string): boolean | null {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return null;
  const [a, b, c] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const octets = match.slice(1, 5).map(Number);
  if (octets.some((octet) => octet > 255)) return true;

  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 // multicast and reserved
  );
}

/** Global unicast IPv6 is 2000::/3; everything else (loopback, ULA, link-local, mapped IPv4…) is refused. */
function isPublicIpv6(literal: string): boolean {
  const inner = literal.slice(1, -1).toLowerCase();
  const firstHextet = inner.split(":")[0];
  if (!firstHextet) return false; // "::" and "::1" start with an empty hextet
  const value = Number.parseInt(firstHextet, 16);
  if (!Number.isFinite(value)) return false;
  // 2001:db8::/32 is documentation space.
  if (inner.startsWith("2001:db8:") || inner.startsWith("2001:0db8:")) return false;
  return (value & 0xe000) === 0x2000;
}

/**
 * True when `hostname` — exactly as `new URL(...).hostname` returns it — is a
 * public DNS name or a public IP literal.
 */
export function isPublicHostname(hostname: string): boolean {
  const host = String(hostname || "").trim().toLowerCase().replace(/\.$/, "");
  if (!host) return false;

  if (host.startsWith("[")) return host.endsWith("]") && isPublicIpv6(host);

  const ipv4 = isPrivateIpv4(host);
  if (ipv4 !== null) return !ipv4;

  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan") || host.endsWith(".home.arpa")) return false;
  // A public name has a dot (`intranet`, `nas`, `router` resolve only on a private network).
  if (!host.includes(".")) return false;
  return true;
}
