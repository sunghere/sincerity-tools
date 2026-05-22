/**
 * Shared URL utilities used by url-qr, url-inspector, and the base64 decoder's
 * "Open" affordance. Kept in one place so the URL-shape rules stay consistent
 * across the codebase.
 */

/**
 * Returns true if `raw` is a single, valid, openable http(s) URL.
 * Deliberately strict: must already start with http:// or https://, no inner
 * whitespace (rules out selections that *contain* a URL inside a sentence),
 * and a hostname must be present.
 */
export function looksLikeUrl(raw: string): boolean {
  const s = raw.trim();
  if (!/^https?:\/\//i.test(s)) return false;
  if (/\s/.test(s)) return false;
  try {
    const u = new URL(s);
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname;
  } catch {
    return false;
  }
}

/** Open icon used by tools that produce URL-ish results. */
export const OPEN_ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M9 2h5v5"/>
  <path d="M14 2 7.5 8.5"/>
  <path d="M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5"/>
</svg>
`.trim();
