/**
 * Content-script entry.
 *
 * Flow:
 *   1. User finishes a text selection (mouseup with non-collapsed selection).
 *   2. We render a Slack-style icon toolbar above the selection with ALL tools.
 *      Each tool's `canHandle()` is a *hint*, not a filter — tools that don't
 *      match the selection still appear, but are visually dimmed.
 *   3. Clicking an icon runs that tool and replaces the toolbar with a popover.
 *      If the tool can't handle the selection, it surfaces its own error popover.
 *
 * Dismissal:
 *   - Toolbar: hides on next selection or on ESC.
 *   - Popover: stays open through outside clicks and scroll. Closes only on
 *     ESC or on the next non-empty selection.
 */
import { tools as allTools } from "../tools/registry";
import type { Tool } from "../types";
import { ensureRoot, isInsideOurUI } from "./root";
import { hidePopover, showPopover } from "./popover";
import { hideToolbar, showToolbar, type ToolbarAnchor, type ToolbarEntry } from "./toolbar";
import { runHiddenTextScan, hideOverlay, SCAN_ID as HIDDEN_TEXT_SCAN_ID } from "../scans/hidden-text-finder";
import { installUrlDblclickHandler, hideUrlPopover } from "./url-actions";

// dblclick fires after the second mouseup, but our selection-toolbar path
// runs via `setTimeout(0)` in onMouseUp — by then dblclick has already
// asked to suppress the toolbar if it detected a URL. The probe returns a
// one-shot true and resets, so subsequent selections behave normally.
const dblclickHandler = installUrlDblclickHandler();

// Wire listeners once.
document.addEventListener("mouseup", onMouseUp, true);
document.addEventListener("keydown", onKeyDown, true);

function onMouseUp(e: MouseEvent): void {
  // Ignore clicks inside our own toolbar/popover.
  if (isInsideOurUI(e.target)) return;

  // Defer to next tick — by the time `mouseup` fires the selection is usually
  // committed, but a 0ms timeout removes the last edge case where it isn't.
  //
  // We capture the event's composedPath() *now* (not inside the timeout) because
  // composedPath() is only valid during dispatch — after dispatch finishes it
  // returns []. The path is what lets us reach selections that live inside an
  // open ShadowRoot: window.getSelection() retargets such selections to the
  // host (so it looks collapsed/empty to us), but ShadowRoot.getSelection()
  // returns the real selection within that root.
  const path = e.composedPath();
  window.setTimeout(() => handleSelection(path), 0);
}

function handleSelection(eventPath: EventTarget[] = []): void {
  // If the just-finished mouseup was actually the second click of a dblclick
  // that landed on a URL, the URL popover is now up. Don't paint the
  // selection toolbar on top of it.
  if (dblclickHandler.shouldSuppressToolbar()) {
    hideToolbar();
    return;
  }

  const picked = pickSelection(eventPath);
  if (!picked) {
    // Empty selection = stray click. Hide toolbar but leave popover alone.
    hideToolbar();
    return;
  }
  const { sel, text } = picked;

  // Any new non-empty selection replaces both toolbar and popover.
  hidePopover();
  hideToolbar();

  if (allTools.length === 0) return;

  ensureRoot();
  const anchor = anchorFromSelection(sel);
  if (!anchor) return;

  // Show every registered tool. canHandle() decides which are "matched"
  // (full opacity / not dimmed); mismatched tools are still clickable.
  const entries: ToolbarEntry[] = allTools.map((tool) => ({
    tool,
    applicable: safeCanHandle(tool, text),
  }));

  // Sort: applicable tools first, then non-applicable. Keeps the most likely
  // pick under the cursor for fast access.
  entries.sort((a, b) => Number(b.applicable) - Number(a.applicable));

  showToolbar({
    entries,
    anchor,
    onPick: (tool) => void runTool(tool, text, anchor),
  });
}

/**
 * Returns the user's current selection, looking *inside* shadow roots when
 * the top-level selection is empty/collapsed.
 *
 * Why: many SPAs (kone.gg, Notion-style editors, Reddit comments) render the
 * post body inside an open ShadowRoot. Selections inside such roots are
 * retargeted by `window.getSelection()` so they look collapsed from the light
 * DOM. Chrome (and other Chromium browsers) expose a non-standard
 * `ShadowRoot.getSelection()` that returns the real selection scoped to that
 * root — we walk the mouseup event's composedPath to find candidate roots.
 *
 * `eventPath` is captured at dispatch time because `composedPath()` returns
 * `[]` once the event has finished propagating.
 */
function pickSelection(eventPath: EventTarget[]): { sel: Selection; text: string } | null {
  // 1. Top-level selection first — handles every normal (non-shadow) case.
  const top = window.getSelection();
  if (top && top.rangeCount > 0 && !top.isCollapsed) {
    const text = top.toString();
    if (text.trim()) return { sel: top, text };
  }

  // 2. Walk the event path for any ShadowRoots and ask each for its selection.
  for (const node of eventPath) {
    if (!(node instanceof ShadowRoot)) continue;
    const shadowSel = (node as ShadowRoot & { getSelection?: () => Selection | null }).getSelection?.();
    if (!shadowSel || shadowSel.rangeCount === 0 || shadowSel.isCollapsed) continue;
    const text = shadowSel.toString();
    if (text.trim()) return { sel: shadowSel, text };
  }

  return null;
}

function safeCanHandle(tool: Tool, text: string): boolean {
  try {
    return tool.canHandle(text);
  } catch {
    return false;
  }
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
    hideUrlPopover();
    // The scan overlay also self-closes on ESC via its own listener; calling
    // hideOverlay() here is the case where the overlay was the *only* UI up.
    hideOverlay();
  }
}

// --- page scans ---
// Triggered from the popup button or the page-context menu item. The runner
// owns its own overlay; we just dispatch by id.
//
// Multi-frame routing: `chrome.tabs.sendMessage` from the popup / background
// only reaches *one* frame (top by default, or info.frameId for right-click).
// To scan iframes too, the receiving frame forwards the request to each of
// its direct children via window.postMessage. Children that are themselves
// our content scripts pick it up via the message listener below and cascade
// the forward to *their* children — this naturally covers arbitrarily deep
// frame trees and works across origins (postMessage to a different-origin
// frame is allowed; only the *receiving* side decides whether to honor it,
// which it does only when the message carries our runtime id).
function runScan(scanId: string): void {
  ensureRoot();
  if (scanId === HIDDEN_TEXT_SCAN_ID) {
    runHiddenTextScan();
  }
  forwardScanToChildFrames(scanId);
}

interface ForwardedScanMessage {
  __sincerityTools: string; // chrome.runtime.id — authenticates the message
  type: "sincerity:run-scan";
  scanId: string;
}

function forwardScanToChildFrames(scanId: string): void {
  const runtimeId = chrome.runtime?.id;
  if (!runtimeId) return;
  const msg: ForwardedScanMessage = {
    __sincerityTools: runtimeId,
    type: "sincerity:run-scan",
    scanId,
  };
  // window.frames length and frame access are safe for direct children even
  // across origins (we can postMessage to them); enumerating descendants
  // ourselves would throw on cross-origin access, so we let each child cascade.
  for (let i = 0; i < window.frames.length; i++) {
    try {
      window.frames[i].postMessage(msg, "*");
    } catch {
      // Some sandbox configurations reject postMessage; ignore.
    }
  }
}

window.addEventListener("message", (e) => {
  const data = e.data as Partial<ForwardedScanMessage> | null | undefined;
  if (!data || typeof data !== "object") return;
  // Verify the message came from our own extension (runtime ids are unique
  // per installation). Anything claiming our shape without the right id is
  // either a typo collision or a malicious page — drop it.
  if (data.__sincerityTools !== chrome.runtime?.id) return;
  if (data.type !== "sincerity:run-scan" || typeof data.scanId !== "string") return;
  runScan(data.scanId);
});

// --- right-click context menu integration ---
// The background script (service worker) registers a "Sincerity Tools" menu
// with one child per tool. When the user picks one, it sends us this message.
// We resolve the tool, derive an anchor from the current selection (falling
// back to a fixed viewport position if the selection has been cleared by the
// time the menu closes), and reuse the same runTool() path as a toolbar click.
chrome.runtime?.onMessage?.addListener((msg) => {
  if (!msg) return;
  if (msg.type === "sincerity:run-scan" && typeof msg.scanId === "string") {
    runScan(msg.scanId);
    return;
  }
  if (msg.type !== "sincerity:run-tool") return;
  const tool = allTools.find((t) => t.id === msg.toolId);
  if (!tool) return;
  const text = (msg.text as string | undefined) || window.getSelection()?.toString() || "";
  if (!text) return;

  let anchor: ToolbarAnchor | null = null;
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
    anchor = anchorFromSelection(sel);
  }
  if (!anchor) {
    // Selection is gone (Chrome usually keeps it, but be safe). Anchor near
    // the top center of the current viewport so the popover is visible.
    anchor = {
      pageX: window.scrollX + window.innerWidth / 2,
      pageY: window.scrollY + 80,
      pageBottom: window.scrollY + 120,
    };
  }
  ensureRoot();
  void runTool(tool, text, anchor);
});

