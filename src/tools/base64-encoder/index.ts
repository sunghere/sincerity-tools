import type { Tool, ToolResult } from "../../types";
import { looksLikeBase64 } from "../base64-decoder/decode";
import { encodeBase64 } from "./encode";

// Three horizontal bars + arrow pointing into a grid, the visual inverse of
// the decoder icon. Same 16x16 viewBox so the toolbar slot looks consistent.
const ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M1.5 5h4M1.5 8h4M1.5 11h4"/>
  <path d="M7 8h4M9 6l2 2-2 2"/>
  <path d="M12.5 4.5h2.2v2.2h-2.2zM12.5 9.3h2.2v2.2h-2.2z"/>
</svg>
`.trim();

export const base64EncoderTool: Tool = {
  id: "base64-encoder",
  name: "base64 인코드",
  iconSvg: ICON_SVG,
  /**
   * Encode is "applicable" when the selection is *not* already base64.
   * For text that already looks like base64, the user almost certainly wants
   * the decoder — but the button remains clickable (just dimmed) so they
   * can still encode if that's really what they want.
   */
  canHandle(selection) {
    return !looksLikeBase64(selection);
  },
  run(selection): ToolResult {
    try {
      const encoded = encodeBase64(selection);
      return {
        title: "UTF-8 → base64",
        body: encoded,
        status: "ok",
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        title: "base64 인코드 실패",
        body: msg,
        status: "error",
      };
    }
  },
};
