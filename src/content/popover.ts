import type { Tool, ToolResult } from "../types";
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

  // --- footer (copy button, only for successful results) ---
  if (opts.result.status !== "error" && opts.result.body) {
    const footer = document.createElement("div");
    footer.className = "popover-footer";

    const copyBtn = document.createElement("button");
    copyBtn.className = "copy-btn";
    copyBtn.type = "button";
    copyBtn.textContent = "복사";
    copyBtn.addEventListener("mousedown", (e) => e.preventDefault());
    copyBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(opts.result.body);
        copyBtn.classList.add("copied");
        copyBtn.textContent = "복사됨";
      } catch {
        copyBtn.textContent = "복사 실패";
      }
      window.setTimeout(() => {
        copyBtn.classList.remove("copied");
        copyBtn.textContent = "복사";
      }, 1200);
    });

    footer.appendChild(copyBtn);
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
