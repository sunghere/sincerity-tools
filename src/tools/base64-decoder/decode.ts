/**
 * base64 detection + UTF-8-safe decode.
 *
 * We are deliberately strict about what we recognize as base64. The toolbar
 * icon shows for any selection where looksLikeBase64 returns true, so a
 * loose matcher would flood the UI with false positives (any English word is
 * "valid base64" by raw alphabet check).
 */

// Standard + URL-safe alphabets. We accept either, with optional `=` padding.
const BASE64_RE = /^[A-Za-z0-9+/]+=*$/;
const BASE64_URL_RE = /^[A-Za-z0-9_-]+=*$/;

export function looksLikeBase64(raw: string): boolean {
  const s = raw.replace(/\s+/g, "");
  if (s.length < 4) return false;
  // base64 encodes 3 bytes -> 4 chars. Padded canonical encodings are always
  // a multiple of 4. Unpadded encodings (common in JWT / URL-safe contexts)
  // can be (4n), (4n+2), or (4n+3) chars. Only (4n+1) is structurally impossible.
  if (s.length % 4 === 1) return false;
  if (!(BASE64_RE.test(s) || BASE64_URL_RE.test(s))) return false;

  // Heuristic: pure-alpha selections of common English words also pass the
  // alphabet test. Require at least one digit, +/_- =, or mixed case to reduce
  // false positives on natural-language selections.
  const hasDigit = /\d/.test(s);
  const hasSpecial = /[+/_\-=]/.test(s);
  const hasMixedCase = /[a-z]/.test(s) && /[A-Z]/.test(s);
  if (!hasDigit && !hasSpecial && !hasMixedCase) return false;

  return true;
}

/**
 * Decode base64 (standard or URL-safe) to a UTF-8 string.
 * Throws on invalid input. Caller catches and renders an error.
 */
export function decodeBase64(raw: string): string {
  const cleaned = raw.replace(/\s+/g, "");
  // Normalize URL-safe alphabet to standard.
  let normalized = cleaned.replace(/-/g, "+").replace(/_/g, "/");
  // Re-pad if missing.
  const pad = normalized.length % 4;
  if (pad === 2) normalized += "==";
  else if (pad === 3) normalized += "=";
  else if (pad === 1) throw new Error("Invalid base64 length");

  // atob -> bytes -> UTF-8 decode. atob alone returns a binary string and
  // mangles multi-byte UTF-8 (Korean, emoji, etc.).
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  // fatal: true makes invalid UTF-8 throw instead of returning replacement chars.
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
