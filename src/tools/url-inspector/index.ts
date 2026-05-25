import type { Tool, ToolAction, ToolResult } from "../../types";
import { OPEN_ICON_SVG, looksLikeUrl } from "../url-shared/parse";
import { collectUrlWarnings } from "../../shared/url-warnings";

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
  canHandle(selection) {
    return looksLikeUrl(selection);
  },
  run(selection): ToolResult {
    const url = selection.trim();
    let u: URL;
    try {
      u = new URL(url);
    } catch (err) {
      return {
        title: "URL 분석 실패",
        body: err instanceof Error ? err.message : String(err),
        status: "error",
      };
    }

    const warnings = collectUrlWarnings(u);
    const params: Array<[string, string]> = [];
    u.searchParams.forEach((v, k) => params.push([k, v]));

    const parts: string[] = [];
    parts.push(`<div class="url-inspect">`);

    if (warnings.length) {
      parts.push(`<div class="url-warn">`);
      for (const w of warnings) {
        parts.push(`<div class="url-warn-row">${esc(w)}</div>`);
      }
      parts.push(`</div>`);
    }

    parts.push(row("도메인", u.hostname));
    if (u.port) parts.push(row("포트", u.port));
    if (u.pathname && u.pathname !== "/") parts.push(row("경로", u.pathname));

    if (params.length) {
      parts.push(`<div class="url-section-label">파라미터</div>`);
      parts.push(`<div class="url-params">`);
      for (const [k, v] of params) {
        let display = v;
        try { display = decodeURIComponent(v); } catch {}
        parts.push(
          `<div class="url-param">` +
          `<span class="url-param-key">${esc(k)}</span>` +
          `<span class="url-param-val">${esc(display)}</span>` +
          `</div>`,
        );
      }
      parts.push(`</div>`);
    }

    if (u.hash) parts.push(row("앵커", u.hash));

    parts.push(`</div>`);

    const actions: ToolAction[] = [
      {
        label: "열기",
        iconSvg: OPEN_ICON_SVG,
        variant: "primary",
        onClick: () => window.open(url, "_blank", "noopener,noreferrer"),
      },
    ];

    return {
      title: u.hostname,
      body: url, // for copy
      bodyHtml: parts.join(""),
      status: "ok",
      actions,
    };
  },
};

// --- helpers ---

function row(label: string, value: string): string {
  return (
    `<div class="url-row">` +
    `<span class="url-label">${esc(label)}</span>` +
    `<span class="url-val">${esc(value)}</span>` +
    `</div>`
  );
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

