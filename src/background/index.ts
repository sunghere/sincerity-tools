/**
 * Background service worker.
 *
 * Registers the right-click context menu hierarchy:
 *
 *   Sincerity Tools  (parent, shows only when text is selected)
 *     ├─ base64 인코드
 *     ├─ base64 디코드
 *     └─ ...
 *
 * When a child item is clicked, we forward the selection text + chosen tool
 * id to the content script via chrome.tabs.sendMessage. The content script
 * then runs the tool and renders the popover — same code path as the
 * hover-toolbar click.
 */
import { tools } from "../tools/registry";

const PARENT_ID = "sincerity-tools-root";
const ITEM_PREFIX = "sincerity:tool:";

function buildMenu(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: PARENT_ID,
      title: "Sincerity Tools",
      contexts: ["selection"],
    });
    for (const tool of tools) {
      chrome.contextMenus.create({
        id: ITEM_PREFIX + tool.id,
        parentId: PARENT_ID,
        title: tool.name,
        contexts: ["selection"],
      });
    }
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
