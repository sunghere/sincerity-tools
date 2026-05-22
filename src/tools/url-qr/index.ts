import QRCode from "qrcode";
import type { Tool, ToolAction, ToolResult } from "../../types";
import { OPEN_ICON_SVG, looksLikeUrl } from "../url-shared/parse";

const ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="1.5" y="1.5" width="5" height="5" rx="0.5"/>
  <rect x="3" y="3" width="2" height="2"/>
  <rect x="9.5" y="1.5" width="5" height="5" rx="0.5"/>
  <rect x="11" y="3" width="2" height="2"/>
  <rect x="1.5" y="9.5" width="5" height="5" rx="0.5"/>
  <rect x="3" y="11" width="2" height="2"/>
  <path d="M9.5 9.5h1.5v1.5h-1.5zM12.5 9.5h1v1h-1zM9.5 12.5h1v1h-1zM12 12h2.5v2.5"/>
</svg>
`.trim();

export const urlQrTool: Tool = {
  id: "url-qr",
  name: "QR 코드로 보기",
  iconSvg: ICON_SVG,
  canHandle(selection) {
    return looksLikeUrl(selection);
  },
  async run(selection): Promise<ToolResult> {
    const url = selection.trim();
    try {
      // White-on-dark so it blends with the popover surface AND scans well —
      // any modern phone camera handles inverted-color QR fine.
      const svg = await QRCode.toString(url, {
        type: "svg",
        margin: 1,
        width: 200,
        errorCorrectionLevel: "M",
        color: { dark: "#ffffff", light: "#0d0d10" },
      });

      const actions: ToolAction[] = [
        {
          label: "열기",
          iconSvg: OPEN_ICON_SVG,
          variant: "primary",
          onClick: () => window.open(url, "_blank", "noopener,noreferrer"),
        },
      ];

      // body stays as the URL (so the copy button copies the link).
      // bodyHtml carries the rendered SVG and a caption.
      const bodyHtml = `
<div class="qr-wrap">
  <div class="qr-frame">${svg}</div>
  <div class="qr-caption">휴대폰 카메라로 스캔하세요</div>
</div>`.trim();

      // Truncate long URLs in the title bar.
      const title = url.length > 50 ? url.slice(0, 50) + "…" : url;
      return { title, body: url, bodyHtml, status: "ok", actions };
    } catch (err) {
      return {
        title: "QR 생성 실패",
        body: err instanceof Error ? err.message : String(err),
        status: "error",
      };
    }
  },
};
