import type { Tool, ToolResult } from "../../types";
import { decodeBase64, looksLikeBase64 } from "./decode";

const ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M2.2 4.2h2.4v2.4H2.2zM2.2 9.4h2.4v2.4H2.2zM6.8 4.2h2.4v2.4H6.8zM6.8 9.4h2.4v2.4H6.8zM11.4 4.2h2.4v2.4h-2.4zM11.4 9.4h2.4v2.4h-2.4z"/>
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
      return {
        title: "base64 → UTF-8",
        body: decoded,
        status: "ok"
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        title: "base64 디코드 실패",
        body: msg,
        status: "error"
      };
    }
  }
};
