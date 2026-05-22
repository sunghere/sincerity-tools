import type { Tool } from "../types";
import { ensureRoot } from "./root";

export interface ToolbarAnchor {
  /** Document-coordinate horizontal center of the selection rect. */
  pageX: number;
  /** Document-coordinate top of the selection rect. */
  pageY: number;
  /** Document-coordinate bottom of the selection rect. */
  pageBottom: number;
}

/**
 * One slot in the toolbar.
 *
 * `applicable` is the result of the tool's `canHandle()` — a *hint* about
 * whether this tool makes sense for the current selection. We render it as
 * a visual dim, NOT as a hard filter, because:
 *
 *   - A tool like "base64 encode" works on plain text, not on base64.
 *   - A tool like "base64 decode" works on base64, not on plain text.
 *
 * Filtering would hide one of them depending on what's selected. Dimming
 * keeps both discoverable while still hinting which one is the likely pick.
 */
export interface ToolbarEntry {
  tool: Tool;
  applicable: boolean;
}

export interface ShowToolbarOpts {
  entries: ToolbarEntry[];
  anchor: ToolbarAnchor;
  onPick: (tool: Tool) => void;
}

let current: HTMLDivElement | null = null;

export function showToolbar(opts: ShowToolbarOpts): void {
  const root = ensureRoot();
  hideToolbar();

  const el = document.createElement("div");
  el.className = "toolbar";
  el.setAttribute("role", "toolbar");
  el.style.pointerEvents = "auto";

  for (const { tool, applicable } of opts.entries) {
    const btn = document.createElement("button");
    btn.className = "toolbar-btn" + (applicable ? "" : " dimmed");
    btn.type = "button";
    btn.dataset.toolId = tool.id;
    btn.setAttribute("aria-label", tool.name);
    btn.innerHTML = tool.iconSvg;

    const tip = document.createElement("span");
    tip.className = "tooltip";
    // Show a hint in the tooltip when the tool doesn't natively apply.
    tip.textContent = applicable ? tool.name : `${tool.name} (적용 안 됨)`;
    btn.appendChild(tip);

    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      opts.onPick(tool);
    });
    el.appendChild(btn);
  }

  // Measure off-screen, then place.
  el.style.visibility = "hidden";
  el.style.top = "0px";
  el.style.left = "0px";
  root.appendChild(el);

  const { width, height } = el.getBoundingClientRect();
  const margin = 8;
  const idealTop = opts.anchor.pageY - height - margin;
  const minTop = window.scrollY + margin;
  const top = idealTop < minTop ? opts.anchor.pageBottom + margin : idealTop;
  const left = Math.max(margin, opts.anchor.pageX - width / 2);

  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
  el.style.visibility = "";

  current = el;
}

export function hideToolbar(): void {
  if (current?.parentNode) current.parentNode.removeChild(current);
  current = null;
}
