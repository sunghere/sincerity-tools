/**
 * Content-script entry.
 *
 * Flow:
 *   1. User finishes a text selection (mouseup with non-collapsed selection).
 *   2. We ask the tool registry which tools apply to the selected text.
 *   3. If any apply, render a Slack-style icon toolbar above the selection.
 *   4. Clicking an icon runs that tool and replaces the toolbar with a popover.
 *
 * Dismissal:
 *   - Toolbar: hides on next selection (whether or not a tool applies),
 *     or on ESC.
 *   - Popover: stays open through outside clicks and scroll. Closes only on
 *     ESC or on the next non-empty selection.
 */
import { findApplicableTools } from "../tools/registry";
import type { Tool } from "../types";
import { ensureRoot, isInsideOurUI } from "./root";
import { hidePopover, showPopover } from "./popover";
import { hideToolbar, showToolbar, type ToolbarAnchor } from "./toolbar";

// Wire listeners once.
document.addEventListener("mouseup", onMouseUp, true);
document.addEventListener("keydown", onKeyDown, true);

function onMouseUp(e: MouseEvent): void {
  // Ignore clicks inside our own toolbar/popover.
  if (isInsideOurUI(e.target)) return;

  // Defer to next tick — by the time `mouseup` fires the selection is usually
  // committed, but a 0ms timeout removes the last edge case where it isn't.
  window.setTimeout(handleSelection, 0);
}

function handleSelection(): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    // Empty selection = stray click. Hide toolbar but leave popover alone.
    hideToolbar();
    return;
  }
  const text = sel.toString();
  if (!text.trim()) {
    hideToolbar();
    return;
  }

  // Any new non-empty selection replaces both toolbar and popover.
  hidePopover();
  hideToolbar();

  const applicable = findApplicableTools(text);
  if (applicable.length === 0) return;

  ensureRoot();
  const anchor = anchorFromSelection(sel);
  if (!anchor) return;

  showToolbar({
    tools: applicable,
    anchor,
    onPick: (tool) => void runTool(tool, text, anchor),
  });
}

async function runTool(tool: Tool, text: string, anchor: ToolbarAnchor): Promise<void> {
  hideToolbar();
  try {
    const result = await Promise.resolve(tool.run(text));
    showPopover({ tool, result, anchor });
  } catch (err) {
    showPopover({
      tool,
      result: {
        title: `${tool.name} 실패`,
        body: err instanceof Error ? err.message : String(err),
        status: "error",
      },
      anchor,
    });
  }
}

function anchorFromSelection(sel: Selection): ToolbarAnchor | null {
  const range = sel.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return {
    pageX: rect.left + window.scrollX + rect.width / 2,
    pageY: rect.top + window.scrollY,
    pageBottom: rect.bottom + window.scrollY,
  };
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    hideToolbar();
    hidePopover();
  }
}
