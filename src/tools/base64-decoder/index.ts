import type { Tool, ToolAction, ToolResult } from "../../types";
import { decodeBase64, looksLikeBase64 } from "./decode";

const ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M2.2 4.2h2.4v2.4H2.2zM2.2 9.4h2.4v2.4H2.2zM6.8 4.2h2.4v2.4H6.8zM6.8 9.4h2.4v2.4H6.8zM11.4 4.2h2.4v2.4h-2.4zM11.4 9.4h2.4v2.4h-2.4z"/>
</svg>
`.trim();

// "External link" icon, used on the "open" action button.
const OPEN_ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M9 2h5v5"/>
  <path d="M14 2 7.5 8.5"/>
  <path d="M12 9.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3.5"/>
</svg>
`.trim();

export const base64DecoderTool: Tool = {
  id: "base64-decoder",
  name: "base64 디코드",
  iconSvg: ICON_SVG,
  canHandle(selection) {
    return looksLikeBase64(selection);
  },
  run(selection): ToolResult {
    try {
      const decoded = decodeBase64(selection.trim());
      const actions: ToolAction[] = [];
      if (isOpenableUrl(decoded)) {
        actions.push({
          label: "열기",
          iconSvg: OPEN_ICON_SVG,
          variant: "primary",
          onClick: () => window.open(decoded.trim(), "_blank", "noopener,noreferrer"),
        });
      }
      return {
        title: "base64 → UTF-8",
        body: decoded,
        status: "ok",
        actions,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        title: "base64 디코드 실패",
        body: msg,
        status: "error",
      };
    }
  },
};

/**
 * Only http(s) URLs get the "open" affordance — never javascript:, data:, file:,
 * or anything else that could surprise the user when clicked.
 */
function isOpenableUrl(raw: string): boolean {
  const s = raw.trim();
  // Cheap reject before constructing URL — must look like a URL on first glance.
  if (!/^https?:\/\//i.test(s)) return false;
  // No whitespace inside (decoded value should be a single URL, not text containing one).
  if (/\s/.test(s)) return false;
  try {
    const u = new URL(s);
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname;
  } catch {
    return false;
  }
}
