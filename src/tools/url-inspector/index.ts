/**
 * URL inspector — the tool the user invokes from the selection toolbar.
 *
 * The actual UI is the rich popover from `src/content/url-actions/popover.ts`
 * which combines:
 *   - URL header (host + path)
 *   - Actions (열기 / 북마크 / 복사)
 *   - Warning chips (IP host, punycode, http, credentials in URL, deep
 *     subdomain — heuristics from src/shared/url-warnings.ts)
 *   - URL breakdown (domain / path / query params)
 *   - Two parallel safety verdicts (NordVPN, Rancert)
 *
 * The tool itself just normalizes the selection into a URL and hands off to
 * `showUrlPopover`, then returns `skipPopover: true` so the framework
 * doesn't paint a generic popover on top.
 */
import type { Tool, ToolResult, ToolRunContext } from "../../types";
import { looksLikeUrl } from "../url-shared/parse";
import { showUrlPopover } from "../../content/url-actions/popover";

const ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="7" cy="7" r="4.5"/>
  <path d="M10.5 10.5l3.5 3.5"/>
  <path d="M5 7h4M7 5v4"/>
</svg>
`.trim();

export const urlInspectorTool: Tool = {
  id: "url-inspector",
  name: "URL 분석",
  iconSvg: ICON_SVG,
  // Also offered when the user right-clicks a hyperlink — the background
  // passes `info.linkUrl` as the tool input and we open the rich popover
  // against that URL. Other tools (base64/qr) keep the default selection-only
  // contexts because a link href isn't a meaningful input to them.
  contexts: ["selection", "link"],
  canHandle(selection) {
    return looksLikeUrl(selection);
  },
  run(selection: string, ctx: ToolRunContext): ToolResult {
    const raw = selection.trim();
    // Normalize before handing off so the popover always sees a valid URL.
    // Bare hostnames like "example.com" get an https:// prefix.
    let normalized: string;
    try {
      const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      const u = new URL(candidate);
      normalized = u.toString();
    } catch (err) {
      return {
        title: "URL 분석 실패",
        body: err instanceof Error ? err.message : String(err),
        status: "error",
      };
    }

    showUrlPopover({
      url: normalized,
      anchor: ctx.anchor,
    });
    // Custom popover already on-screen; suppress the generic one.
    return {
      body: normalized,
      status: "ok",
      skipPopover: true,
    };
  },
};
