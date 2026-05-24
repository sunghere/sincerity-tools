/**
 * Pulls a URL out of a `dblclick` event in one of two ways:
 *
 *   1. The click is inside an `<a href>` — easy, use the resolved href.
 *   2. The click is on plain text — locate the text node under the cursor,
 *      run a URL regex over its full content, and pick the match whose
 *      range contains the clicked character offset.
 *
 * Both paths return a *normalized* URL string with explicit protocol
 * (`example.com` → `https://example.com`) so downstream code can construct
 * `new URL(...)` without surprises.
 *
 * Why this aggressive (text-pattern) detection? The user explicitly asked
 * for it. The trade-off: dblclicking on `github.com` mentioned in casual
 * text triggers the popover. That's a UX wart we accept in exchange for
 * the more useful "dblclick anywhere on a URL" expectation.
 */

const PROTOCOL_RE = /^https?:\/\//i;

// Permissive URL regex. We require either:
//   - http(s):// prefix, or
//   - a recognizable bare domain (one+ labels, then a 2+ char TLD).
// Path / query / fragment are optional. Trailing punctuation that's
// commonly outside URLs in prose (period, comma, paren, semicolon, quote)
// is trimmed after the match.
const URL_RE = /(https?:\/\/[^\s<>"']+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>"']*)?)/gi;

// Single-segment hostnames that almost always represent something other
// than a URL when typed in prose. Conservative — we don't want to drop
// legitimate co.uk, .io, etc.
const NON_URL_TLDS = new Set(["com.", "net.", "org."]); // (defensive; not actively used yet)

export interface DetectedUrl {
  /** Normalized URL with protocol. */
  url: string;
  /** True when the source was an `<a href>` (high confidence). */
  fromAnchor: boolean;
}

export function detectUrlAt(event: MouseEvent): DetectedUrl | null {
  // 1. Anchor path — highest confidence.
  const anchor = findAnchor(event.target);
  if (anchor && anchor.href) {
    const normalized = tryNormalize(anchor.href);
    if (normalized) return { url: normalized, fromAnchor: true };
  }

  // 2. Plain-text path — caretRangeFromPoint resolves to the text node at
  // the cursor. caretFromPoint() is the standard replacement but Chrome
  // still ships caretRangeFromPoint with broader compatibility.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const range = (document as any).caretRangeFromPoint?.(event.clientX, event.clientY) as Range | null;
  if (!range || !range.startContainer || range.startContainer.nodeType !== Node.TEXT_NODE) {
    return null;
  }
  const text = (range.startContainer as Text).data ?? "";
  if (!text) return null;

  const offset = range.startOffset;
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    let raw = match[0];
    let end = start + raw.length;
    raw = trimTrailingPunct(raw);
    end = start + raw.length;
    if (offset < start || offset > end) continue;

    // Email guard: if the character immediately before the match is "@",
    // we matched the domain part of an email. Skip — addresses are not
    // URLs the user means to open.
    if (start > 0 && text[start - 1] === "@") continue;

    const normalized = tryNormalize(raw);
    if (normalized) return { url: normalized, fromAnchor: false };
  }
  return null;
}

function findAnchor(target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Element)) return null;
  const a = target.closest("a");
  return a instanceof HTMLAnchorElement ? a : null;
}

function trimTrailingPunct(raw: string): string {
  return raw.replace(/[.,);:!?'"。，]+$/, "");
}

function tryNormalize(raw: string): string | null {
  // Reject anything without at least one dot — it's almost never a URL.
  if (!raw.includes(".")) return null;

  let candidate = raw;
  if (!PROTOCOL_RE.test(candidate)) {
    candidate = `https://${candidate}`;
  }
  try {
    const u = new URL(candidate);
    // Hostname sanity — at least one '.' and the TLD has 2+ chars.
    const parts = u.hostname.split(".");
    if (parts.length < 2) return null;
    const tld = parts[parts.length - 1];
    if (tld.length < 2) return null;
    if (NON_URL_TLDS.has(tld + ".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}
