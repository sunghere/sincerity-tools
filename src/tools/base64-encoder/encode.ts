/**
 * UTF-8-safe base64 encode.
 *
 * Mirrors decode.ts: TextEncoder produces canonical UTF-8 bytes, then we
 * marshal them into a binary string for btoa(). atob/btoa speak Latin-1,
 * so we cannot pass non-ASCII strings directly.
 */
export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  // Build a binary string. String.fromCharCode.apply with a typed array used
  // to be the idiomatic move; spread is fine for selection-sized inputs.
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
