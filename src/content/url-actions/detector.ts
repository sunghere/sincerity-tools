/**
 * Pulls a URL out of a `dblclick` event in one of two ways:
 *
 *   1. The click is inside an `<a href>` — easy, use the resolved href.
 *      `event.composedPath()` is consulted so the lookup pierces open
 *      shadow roots (web-component links work).
 *   2. The click is on plain text — locate the text node under the cursor
 *      via caretRangeFromPoint, run a URL regex over its full content, and
 *      pick the match whose range contains the clicked character offset.
 *
 * Both paths return a *normalized* URL string with explicit protocol
 * (`example.com` → `https://example.com`) plus the DOMRect we should anchor
 * the popover to (the actual clicked line/range, not the full element box —
 * a multi-line `<a>` or whole `<p>` was producing wildly off-cursor popovers).
 */

const PROTOCOL_RE = /^https?:\/\//i;

// Permissive URL regex. We require either:
//   - http(s):// prefix, or
//   - a recognizable bare domain (one+ labels, then a 2+ char TLD).
// Path / query / fragment are optional. Trailing punctuation that's
// commonly outside URLs in prose (period, comma, paren, semicolon, quote)
// is trimmed after the match.
const URL_RE = /(https?:\/\/[^\s<>"']+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>"']*)?)/gi;

export interface DetectedUrl {
  /** Normalized URL with protocol. */
  url: string;
  /** True when the source was an `<a href>` (high confidence). */
  fromAnchor: boolean;
  /**
   * Viewport-relative rect to anchor the popover under. For anchor matches
   * we pick the rect under the cursor (handles line-wrapped links); for
   * text matches we use the matched range's bounding rect (so the popover
   * sits right under the URL, not under the whole paragraph).
   */
  rect: DOMRect;
}

export function detectUrlAt(event: MouseEvent): DetectedUrl | null {
  // 1. Anchor path — highest confidence. Walk composedPath so shadow-DOM
  // <a>s (web components, embedded post bodies) are reachable; closest('a')
  // alone stops at the shadow boundary.
  const anchor = findAnchorInPath(event.composedPath());
  if (anchor && anchor.href) {
    const normalized = tryNormalize(anchor.href);
    if (normalized) {
      const rect = rectUnderCursor(anchor, event) ?? anchor.getBoundingClientRect();
      return { url: normalized, fromAnchor: true, rect };
    }
  }

  // 2. Plain-text path.
  const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
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
    if (!normalized) continue;
    // Re-open a range covering just the matched substring so the rect
    // reflects the URL's actual line(s), not the entire text node.
    const r = document.createRange();
    try {
      r.setStart(range.startContainer, start);
      r.setEnd(range.startContainer, end);
    } catch {
      return { url: normalized, fromAnchor: false, rect: range.getBoundingClientRect() };
    }
    return { url: normalized, fromAnchor: false, rect: r.getBoundingClientRect() };
  }
  return null;
}

function findAnchorInPath(path: EventTarget[]): HTMLAnchorElement | null {
  for (const node of path) {
    if (node instanceof HTMLAnchorElement && node.href) return node;
  }
  return null;
}

/**
 * For a multi-line anchor (wraps across rows), `getBoundingClientRect()`
 * returns the union — anchoring there puts the popover at the midpoint of
 * the union, often far above or below the clicked line. Iterate the
 * per-line client rects and pick the one whose vertical range contains
 * the cursor.
 */
function rectUnderCursor(el: Element, event: MouseEvent): DOMRect | null {
  const rects = Array.from(el.getClientRects());
  if (rects.length <= 1) return rects[0] ?? null;
  for (const r of rects) {
    if (event.clientY >= r.top && event.clientY <= r.bottom) return r;
  }
  return rects[0];
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
    return u.toString();
  } catch {
    return null;
  }
}
