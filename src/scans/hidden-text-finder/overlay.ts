/**
 * Page overlay UI for hidden-text findings. Renders one outlined box per
 * finding (subtle), plus a stronger ring + page scroll for the *active*
 * finding. A fixed top-right toast carries the navigation controls (prev /
 * next / close) and shows the active finding's score, reasons, and a copyable
 * preview of the text.
 *
 * Positioning:
 *   - Outlined boxes use position:absolute with page coordinates, so they
 *     scroll with the document (the same trick the selection toolbar uses).
 *   - The toast uses position:fixed so it stays in view.
 *   - The active ring is recomputed from getBoundingClientRect() right before
 *     scroll-into-view, because pages mutate during scrolling (lazy-loaded
 *     images shift layout, etc.) and the page-coord snapshot captured at scan
 *     time may have drifted.
 */
import { ensureRoot } from "../../content/root";
import type { Finding } from "./scanner";

/**
 * Overlay lives inside the shadow root that's already created by
 * src/content/root.ts. We share the host across the selection toolbar /
 * popover and this overlay.
 *
 * Multi-frame behavior:
 *   - Every frame (top and child) renders its own outlined boxes for findings
 *     in *its* document. Cross-frame element references aren't transferable,
 *     so each frame draws what it owns.
 *   - Only the top frame builds the interactive toast (count + ←/→/ESC).
 *     Child-frame toasts on ad-heavy pages would be chaotic and most ad
 *     iframes are too small to fit one anyway. Users who want to navigate
 *     findings inside a specific iframe can right-click in that iframe — the
 *     scan runs there and then forwards to its own descendants only.
 */
const IS_TOP_FRAME = (() => {
  try {
    return window.top === window;
  } catch {
    // Cross-origin access can throw when reaching for window.top. If we
    // can't tell, assume we're not the top frame and stay quiet.
    return false;
  }
})();

interface OverlayState {
  findings: Finding[];
  truncated: boolean;
  layer: HTMLDivElement;
  activeRing: HTMLDivElement;
  toast: HTMLDivElement | null;
  boxes: HTMLDivElement[];
  activeIdx: number;
  cleanup: () => void;
}

let current: OverlayState | null = null;

export interface ShowOverlayOpts {
  findings: Finding[];
  truncated?: boolean;
}

export function showOverlay(opts: ShowOverlayOpts): void {
  const { findings, truncated = false } = opts;
  hideOverlay();

  const root = ensureRoot();
  ensureScanStyles(root);

  if (findings.length === 0) {
    // Don't show the "no findings" toast in child frames — only the top frame
    // is the user's focus, and child-frame popovers about empty scans would
    // be noise.
    if (IS_TOP_FRAME) {
      showEphemeralToast(root, "히든 텍스트 의심 없음", "이 페이지에서는 임계점을 넘는 항목을 찾지 못했어요.");
    }
    return;
  }

  const layer = document.createElement("div");
  layer.className = "scan-layer";

  const boxes: HTMLDivElement[] = [];
  for (const f of findings) {
    const box = document.createElement("div");
    box.className = "scan-box";
    box.style.top = `${f.pageRect.top}px`;
    box.style.left = `${f.pageRect.left}px`;
    // Tiny rects (zero-size offenders) get a visible nub anyway.
    box.style.width = `${Math.max(f.pageRect.width, 6)}px`;
    box.style.height = `${Math.max(f.pageRect.height, 6)}px`;
    layer.appendChild(box);
    boxes.push(box);
  }

  // The active ring lives on top, position:fixed so we can drive it from
  // getBoundingClientRect() directly without juggling scroll math.
  const activeRing = document.createElement("div");
  activeRing.className = "scan-active-ring";
  activeRing.style.display = "none";

  const toast = IS_TOP_FRAME ? buildToast(findings.length, truncated) : null;

  root.appendChild(layer);
  root.appendChild(activeRing);
  if (toast) root.appendChild(toast);

  const state: OverlayState = {
    findings,
    truncated,
    layer,
    activeRing,
    toast,
    boxes,
    activeIdx: -1,
    cleanup: () => {},
  };
  current = state;

  const onKey = (e: KeyboardEvent) => {
    if (!current) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      hideOverlay();
      return;
    }
    // Arrow-key navigation only makes sense where the toast is present.
    if (!IS_TOP_FRAME) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      jump(1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      jump(-1);
    }
  };

  const onScrollOrResize = () => {
    if (!current) return;
    repositionActive();
  };

  document.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", onScrollOrResize, { passive: true });
  window.addEventListener("resize", onScrollOrResize);

  state.cleanup = () => {
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", onScrollOrResize);
    window.removeEventListener("resize", onScrollOrResize);
  };

  // Wire toast buttons — only present in the top frame.
  if (toast) {
    toast.querySelector<HTMLButtonElement>(".scan-prev")?.addEventListener("click", () => jump(-1));
    toast.querySelector<HTMLButtonElement>(".scan-next")?.addEventListener("click", () => jump(1));
    toast.querySelector<HTMLButtonElement>(".scan-close")?.addEventListener("click", () => hideOverlay());
    toast.querySelector<HTMLButtonElement>(".scan-copy")?.addEventListener("click", () => {
      if (!current) return;
      const f = current.findings[current.activeIdx];
      if (!f) return;
      void navigator.clipboard.writeText(f.fullText).then(() => {
        const btn = toast.querySelector<HTMLButtonElement>(".scan-copy");
        if (!btn) return;
        const prev = btn.textContent;
        btn.textContent = "복사됨";
        window.setTimeout(() => {
          btn.textContent = prev ?? "복사";
        }, 1200);
      });
    });
  }

  jump(1, /* fromInit */ true);
}

export function hideOverlay(): void {
  if (!current) return;
  current.cleanup();
  current.layer.remove();
  current.activeRing.remove();
  current.toast?.remove();
  current = null;
}

function jump(delta: number, fromInit = false): void {
  if (!current) return;
  const n = current.findings.length;
  if (n === 0) return;

  let next: number;
  if (fromInit) {
    next = 0;
  } else if (current.activeIdx < 0) {
    next = 0;
  } else {
    next = (current.activeIdx + delta + n) % n;
  }

  for (const box of current.boxes) box.classList.remove("active");
  current.activeIdx = next;
  current.boxes[next]?.classList.add("active");

  const f = current.findings[next];
  if (!f) return;

  // Scroll the page so the finding is in view, *then* park the active ring on
  // its updated bounding rect. Using "instant" so the ring doesn't lag behind
  // a smooth scroll animation.
  f.element.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
  repositionActive();
  fillToastDetail(f, next);
}

function repositionActive(): void {
  if (!current) return;
  const f = current.findings[current.activeIdx];
  if (!f) return;
  const r = f.element.getBoundingClientRect();
  const ring = current.activeRing;
  if (r.width === 0 && r.height === 0) {
    // Zero-size finding (e.g. font-size:0) — show a small marker at its origin.
    ring.style.display = "block";
    ring.style.top = `${r.top}px`;
    ring.style.left = `${r.left}px`;
    ring.style.width = `10px`;
    ring.style.height = `10px`;
    return;
  }
  ring.style.display = "block";
  ring.style.top = `${r.top - 3}px`;
  ring.style.left = `${r.left - 3}px`;
  ring.style.width = `${r.width + 6}px`;
  ring.style.height = `${r.height + 6}px`;
}

function buildToast(total: number, truncated: boolean): HTMLDivElement {
  const t = document.createElement("div");
  t.className = "scan-toast";
  const truncBadge = truncated
    ? `<span class="scan-trunc" title="스캔 범위 한도(MAX_TEXT_NODES)에 도달해 일부 노드를 건너뛰었어요.">일부 생략</span>`
    : "";
  t.innerHTML = `
    <div class="scan-toast-head">
      <div class="scan-title">
        <span class="scan-dot"></span>
        히든 텍스트 <strong class="scan-total">${total}</strong>개 의심
        ${truncBadge}
      </div>
      <button class="scan-close" type="button" aria-label="닫기">×</button>
    </div>
    <div class="scan-toast-nav">
      <button class="scan-prev" type="button" aria-label="이전">◀</button>
      <span class="scan-pos"><span class="scan-cur">0</span> / ${total}</span>
      <button class="scan-next" type="button" aria-label="다음">▶</button>
      <span class="scan-spacer"></span>
      <span class="scan-score-pill" title="confidence score 0~100">—</span>
    </div>
    <div class="scan-toast-detail">
      <div class="scan-preview"></div>
      <div class="scan-reasons"></div>
      <div class="scan-toast-foot">
        <button class="scan-copy" type="button">복사</button>
        <span class="scan-hint">← →로 순회 · ESC 닫기</span>
      </div>
    </div>
  `;
  return t;
}

function fillToastDetail(f: Finding, idx: number): void {
  if (!current || !current.toast) return;
  const t = current.toast;
  setText(t, ".scan-cur", String(idx + 1));
  setText(t, ".scan-score-pill", `score ${f.score}`);
  const pill = t.querySelector<HTMLElement>(".scan-score-pill");
  if (pill) {
    pill.classList.remove("hi", "mid", "lo");
    pill.classList.add(f.score >= 70 ? "hi" : f.score >= 45 ? "mid" : "lo");
  }

  const preview = t.querySelector<HTMLElement>(".scan-preview");
  if (preview) {
    preview.textContent = f.text;
    preview.title = f.fullText;
  }

  const reasons = t.querySelector<HTMLElement>(".scan-reasons");
  if (reasons) {
    reasons.innerHTML = "";
    for (const r of f.reasons) {
      const chip = document.createElement("span");
      chip.className = "scan-reason" + (r.weight < 0 ? " neg" : "");
      chip.textContent = `${labelForReason(r.code)} · ${r.detail}`;
      reasons.appendChild(chip);
    }
    if (f.contrast != null) {
      const chip = document.createElement("span");
      chip.className = "scan-reason swatch";
      chip.innerHTML = `<span class="sw" style="background:${f.fg}"></span>on<span class="sw" style="background:${f.bg ?? "#fff"}"></span>${f.contrast.toFixed(2)}:1`;
      reasons.appendChild(chip);
    }
  }
}

function setText(parent: ParentNode, sel: string, text: string): void {
  const el = parent.querySelector<HTMLElement>(sel);
  if (el) el.textContent = text;
}

function labelForReason(code: string): string {
  switch (code) {
    case "contrast": return "대비";
    case "color-transparent": return "투명 색상";
    case "opacity": return "투명도";
    case "tiny-font": return "작은 글꼴";
    case "offscreen-text-indent": return "text-indent off-screen";
    case "offscreen-position": return "position off-screen";
    case "clipped": return "clip";
    case "zero-size": return "0 사이즈";
    case "aria-intent": return "스크린리더 전용 의심";
    default: return code;
  }
}

function showEphemeralToast(root: ShadowRoot, title: string, body: string): void {
  const t = document.createElement("div");
  t.className = "scan-toast scan-toast-empty";
  t.innerHTML = `
    <div class="scan-toast-head">
      <div class="scan-title"><span class="scan-dot ok"></span>${title}</div>
      <button class="scan-close" type="button" aria-label="닫기">×</button>
    </div>
    <div class="scan-toast-body">${body}</div>
  `;
  t.querySelector<HTMLButtonElement>(".scan-close")?.addEventListener("click", () => t.remove());
  root.appendChild(t);
  window.setTimeout(() => t.remove(), 4000);
}

// --- styles ---

function ensureScanStyles(root: ShadowRoot): void {
  if (root.querySelector("style[data-sincerity-scan]")) return;
  const s = document.createElement("style");
  s.setAttribute("data-sincerity-scan", "");
  s.textContent = SCAN_STYLES;
  root.appendChild(s);
}

const SCAN_STYLES = `
  .scan-layer {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    z-index: 2147483640;
  }
  .scan-box {
    position: absolute;
    outline: 1px dashed rgba(250, 204, 21, 0.55);
    background: rgba(250, 204, 21, 0.06);
    border-radius: 2px;
    pointer-events: none;
  }
  .scan-box.active {
    outline-color: rgba(250, 204, 21, 0);
    background: transparent;
  }
  .scan-active-ring {
    position: fixed;
    border: 2px solid #facc15;
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.45), 0 0 14px rgba(250, 204, 21, 0.6);
    border-radius: 3px;
    pointer-events: none;
    z-index: 2147483646;
    /* Intentionally no transition: scroll-driven repositioning would restart
       the animation every frame and the ring would visibly lag the target. */
  }

  .scan-toast {
    position: fixed;
    top: 16px;
    right: 16px;
    min-width: 280px;
    max-width: 340px;
    z-index: 2147483647;
    background: #1d1d20;
    color: #e8e8ec;
    border: 1px solid #2c2c33;
    border-radius: 10px;
    box-shadow: 0 10px 32px rgba(0, 0, 0, 0.45);
    overflow: hidden;
    user-select: none;
    pointer-events: auto;
  }
  .scan-toast-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px 8px 12px;
    background: #25252b;
    border-bottom: 1px solid #2c2c33;
    font-size: 12px;
    font-weight: 600;
  }
  .scan-title { display: inline-flex; align-items: center; gap: 8px; }
  .scan-total { color: #facc15; font-weight: 700; }
  .scan-trunc {
    font-size: 9.5px;
    font-weight: 600;
    color: #fbbf24;
    background: rgba(251, 191, 36, 0.12);
    border: 1px solid rgba(251, 191, 36, 0.32);
    border-radius: 3px;
    padding: 1px 5px;
    letter-spacing: 0.4px;
    cursor: help;
  }
  .scan-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #facc15;
    box-shadow: 0 0 6px rgba(250, 204, 21, 0.7);
  }
  .scan-dot.ok { background: #7ad17a; box-shadow: 0 0 6px rgba(122, 209, 122, 0.6); }
  .scan-close {
    background: transparent;
    border: 0;
    color: #8a8a93;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
  }
  .scan-close:hover { color: #fff; background: #2c2c33; }

  .scan-toast-nav {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: #1a1a1d;
    border-bottom: 1px solid #2c2c33;
    font-size: 11.5px;
    color: #b9b9c2;
  }
  .scan-prev, .scan-next {
    background: transparent;
    border: 1px solid #3a3a42;
    color: #d4d4d8;
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 11px;
    cursor: pointer;
  }
  .scan-prev:hover, .scan-next:hover { background: #2c2c33; color: #fff; }
  .scan-pos { font-variant-numeric: tabular-nums; }
  .scan-spacer { flex: 1; }
  .scan-score-pill {
    font-size: 10.5px;
    padding: 2px 6px;
    border-radius: 3px;
    background: #2c2c33;
    color: #d4d4d8;
    font-variant-numeric: tabular-nums;
  }
  .scan-score-pill.hi { background: #3f1d1d; color: #ff9c9c; }
  .scan-score-pill.mid { background: #3f3214; color: #facc15; }
  .scan-score-pill.lo { background: #1f3320; color: #93d59a; }

  .scan-toast-detail {
    padding: 10px 12px;
    font-size: 11.5px;
  }
  .scan-preview {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11.5px;
    line-height: 1.5;
    background: #0d0d10;
    color: #e8e8ec;
    border-radius: 5px;
    padding: 8px 10px;
    max-height: 110px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-all;
    margin-bottom: 8px;
  }
  .scan-reasons {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 10px;
  }
  .scan-reason {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10.5px;
    line-height: 1.4;
    background: #2c2c33;
    color: #d4d4d8;
    padding: 2px 6px;
    border-radius: 3px;
  }
  .scan-reason.neg { background: #1f3320; color: #93d59a; }
  .scan-reason.swatch .sw {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    display: inline-block;
  }

  .scan-toast-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .scan-copy {
    background: transparent;
    border: 1px solid #3a3a42;
    color: #ccc;
    border-radius: 4px;
    padding: 3px 9px;
    font-size: 11px;
    cursor: pointer;
  }
  .scan-copy:hover { background: #2c2c33; color: #fff; }
  .scan-hint { color: #8a8a93; font-size: 10.5px; }

  .scan-toast-empty .scan-toast-body {
    padding: 10px 12px;
    font-size: 11.5px;
    color: #b9b9c2;
    line-height: 1.5;
  }
`;
