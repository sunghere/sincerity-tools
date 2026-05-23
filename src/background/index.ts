/**
 * Background service worker.
 *
 * Registers the right-click context menu hierarchy:
 *
 *   Sincerity Tools  (parent, visible on selection or on plain page click)
 *     ├─ base64 인코드         (selection-only)
 *     ├─ base64 디코드         (selection-only)
 *     ├─ ...                   (selection-only)
 *     └─ 히든 텍스트 찾기      (page-only, no selection required)
 *
 * Selection-driven children forward the selection text + chosen tool id to
 * the content script. The page-scan child sends a different message that
 * triggers a full-page scan (no selection involved).
 */
import { tools } from "../tools/registry";

const PARENT_ID = "sincerity-tools-root";
const ITEM_PREFIX = "sincerity:tool:";
const SCAN_HIDDEN_TEXT_ID = "sincerity:scan:hidden-text-finder";

function buildMenu(): void {
  chrome.contextMenus.removeAll(() => {
    // Parent appears whenever either a selection-driven child or the page
    // scan would apply — i.e. on either a selection or a plain page click.
    chrome.contextMenus.create({
      id: PARENT_ID,
      title: "Sincerity Tools",
      contexts: ["selection", "page"],
    });
    for (const tool of tools) {
      chrome.contextMenus.create({
        id: ITEM_PREFIX + tool.id,
        parentId: PARENT_ID,
        title: tool.name,
        contexts: ["selection"],
      });
    }
    // Page scan child — visible without a selection.
    chrome.contextMenus.create({
      id: SCAN_HIDDEN_TEXT_ID,
      parentId: PARENT_ID,
      title: "히든 텍스트 찾기",
      contexts: ["page"],
    });
  });
}

// (Re)build on install/update and on every service-worker startup, since
// MV3 service workers can be torn down and the menu state isn't persisted
// across reload in all Chrome versions.
chrome.runtime.onInstalled.addListener(buildMenu);
chrome.runtime.onStartup?.addListener(buildMenu);
buildMenu();

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  const id = String(info.menuItemId);

  // Page scans first — they don't carry selection text.
  //
  // Always route to the top frame (no frameId): the content script there
  // runs its own scan AND forwards to descendants via postMessage. Targeting
  // info.frameId would scan only the right-clicked frame and miss its
  // siblings, which is the wrong intent for a "scan this page" action.
  if (id === SCAN_HIDDEN_TEXT_ID) {
    chrome.tabs.sendMessage(tab.id, {
      type: "sincerity:run-scan",
      scanId: "hidden-text-finder",
    });
    return;
  }

  if (!id.startsWith(ITEM_PREFIX)) return;
  const toolId = id.slice(ITEM_PREFIX.length);
  // Right-click happens *inside* the frame where the selection lives, which
  // can be an iframe (kone.gg-style embedded body, Notion, etc.). We must
  // route the message to that specific frame; otherwise we'd send it to the
  // top frame which has no idea about the selection.
  const message = {
    type: "sincerity:run-tool",
    toolId,
    text: info.selectionText ?? "",
  };
  if (info.frameId !== undefined) {
    chrome.tabs.sendMessage(tab.id, message, { frameId: info.frameId });
  } else {
    chrome.tabs.sendMessage(tab.id, message);
  }
});
