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

export interface ShowToolbarOpts {
  tools: Tool[];
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
  // Re-enable pointer events; the host element disables them so the page is interactive.
  el.style.pointerEvents = "auto";

  for (const tool of opts.tools) {
    const btn = document.createElement("button");
    btn.className = "toolbar-btn";
    btn.type = "button";
    btn.dataset.toolId = tool.id;
    btn.setAttribute("aria-label", tool.name);
    btn.innerHTML = tool.iconSvg;

    const tip = document.createElement("span");
    tip.className = "tooltip";
    tip.textContent = tool.name;
    btn.appendChild(tip);

    // preventDefault on mousedown so clicking the button doesn't collapse the
    // page selection — we don't strictly need it after the toolbar opens, but
    // it prevents jitter if the user mis-clicks twice.
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      opts.onPick(tool);
    });
    el.appendChild(btn);
  }

  // Measure off-screen, then place. Avoids a one-frame flash at (0, 0).
  el.style.visibility = "hidden";
  el.style.top = "0px";
  el.style.left = "0px";
  root.appendChild(el);

  const { width, height } = el.getBoundingClientRect();
  const margin = 8;
  const idealTop = opts.anchor.pageY - height - margin;
  const minTop = window.scrollY + margin;
  // If too close to the top of the viewport, flip below the selection.
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
