import type { Tool, ToolAction, ToolResult } from "../types";
import { ensureRoot } from "./root";
import type { ToolbarAnchor } from "./toolbar";

export interface ShowPopoverOpts {
  tool: Tool;
  result: ToolResult;
  anchor: ToolbarAnchor;
}

let current: HTMLDivElement | null = null;

export function showPopover(opts: ShowPopoverOpts): void {
  const root = ensureRoot();
  hidePopover();

  const el = document.createElement("div");
  el.className = "popover" + (opts.result.status === "error" ? " error" : "");
  el.style.pointerEvents = "auto";

  // --- header ---
  const header = document.createElement("div");
  header.className = "popover-header";

  const title = document.createElement("span");
  title.className = "popover-title";
  title.textContent = opts.result.title ?? opts.tool.name;

  // Subtle "ESC" affordance — communicates the dismissal shortcut without
  // adding a click target that conflicts with the "popover doesn't close on
  // outside click" requirement.
  const hint = document.createElement("span");
  hint.className = "popover-hint";
  hint.textContent = "ESC";

  header.appendChild(title);
  header.appendChild(hint);

  // --- body ---
  const body = document.createElement("div");
  body.className = "popover-body";
  if (opts.result.bodyHtml) {
    // Trusted markup path — tools that produce HTML are responsible for sanitization.
    body.innerHTML = opts.result.bodyHtml;
  } else {
    // Default path: render as textContent so selection content can't inject HTML.
    body.textContent = opts.result.body;
  }

  el.appendChild(header);
  el.appendChild(body);

  // --- footer ---
  // Shown when there's at least one button to render: tool-provided actions
  // and/or the default copy button for successful results.
  const showCopy = opts.result.status !== "error" && !!opts.result.body;
  const actions = opts.result.actions ?? [];
  if (showCopy || actions.length > 0) {
    const footer = document.createElement("div");
    footer.className = "popover-footer";

    // Tool-provided actions first (left side), copy on the right.
    for (const action of actions) {
      footer.appendChild(buildActionButton(action));
    }

    if (showCopy) {
      // Spacer pushes the copy button to the right when actions exist on the left.
      if (actions.length > 0) {
        const spacer = document.createElement("span");
        spacer.style.flex = "1";
        footer.appendChild(spacer);
      }
      footer.appendChild(buildCopyButton(opts.result.body));
    }

    el.appendChild(footer);
  }

  // --- positioning ---
  // The popover anchors to the page (position: absolute with document coords),
  // so it scrolls with the page naturally. We deliberately do NOT reposition
  // on scroll: the spec says "okay to go off-screen".
  el.style.visibility = "hidden";
  el.style.top = "0px";
  el.style.left = "0px";
  root.appendChild(el);

  const { width } = el.getBoundingClientRect();
  const margin = 8;
  const left = Math.max(margin, opts.anchor.pageX - width / 2);
  const top = opts.anchor.pageBottom + margin;
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
  el.style.visibility = "";

  current = el;
}

export function hidePopover(): void {
  if (current?.parentNode) current.parentNode.removeChild(current);
  current = null;
}

export function isPopoverOpen(): boolean {
  return current !== null;
}

// --------------------------- internals ---------------------------

function buildActionButton(action: ToolAction): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "footer-btn" + (action.variant === "primary" ? " primary" : "");
  if (action.iconSvg) {
    const icon = document.createElement("span");
    icon.className = "footer-btn-icon";
    icon.innerHTML = action.iconSvg;
    btn.appendChild(icon);
  }
  const label = document.createElement("span");
  label.textContent = action.label;
  btn.appendChild(label);
  // preventDefault on mousedown so clicking the button never collapses any
  // remaining page selection underneath the popover.
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    try {
      action.onClick();
    } catch (err) {
      console.error("[sincerity-tools] action failed:", err);
    }
  });
  return btn;
}

function buildCopyButton(text: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "footer-btn copy-btn";
  btn.textContent = "복사";
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      btn.classList.add("copied");
      btn.textContent = "복사됨";
    } catch {
      btn.textContent = "복사 실패";
    }
    window.setTimeout(() => {
      btn.classList.remove("copied");
      btn.textContent = "복사";
    }, 1200);
  });
  return btn;
}
