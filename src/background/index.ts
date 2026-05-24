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

// --- URL-on-dblclick: bookmark create + safety check proxy ---
//
// The content-script popover talks to us via sendMessage. We handle the two
// requests it can make:
//   1. sincerity:bookmark-add — chrome.bookmarks.create after verifying that
//      the optional 'bookmarks' permission was granted. We don't re-prompt
//      from here (permission requests require a user-gesture context that
//      doesn't survive across sendMessage in MV3); the content script asks
//      first and only sends this when it already holds permission.
//   2. sincerity:check-url — POST to NordVPN's link-checker. Done from the
//      background to centralize host_permissions and to avoid CORS quirks in
//      arbitrary content-script origins.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;
  const m = msg as { type?: unknown; url?: unknown };

  if (m.type === "sincerity:bookmark-add" && typeof m.url === "string") {
    handleBookmarkAdd(m.url).then(sendResponse);
    return true; // keep the message channel open for the async response
  }

  if (m.type === "sincerity:check-url" && typeof m.url === "string") {
    handleCheckUrl(m.url).then(sendResponse);
    return true;
  }

  return undefined;
});

async function handleBookmarkAdd(url: string): Promise<{ ok: boolean; reason?: string }> {
  // Permission gate first — the content script should have requested before
  // sending the message, but we re-verify here. A user who clicked
  // "remove permission" mid-session would otherwise crash.
  try {
    const granted = await chrome.permissions.contains({ permissions: ["bookmarks"] });
    if (!granted) return { ok: false, reason: "permission-denied" };
  } catch {
    return { ok: false, reason: "permission-denied" };
  }
  try {
    const title = friendlyTitle(url);
    await chrome.bookmarks.create({ title, url });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

function friendlyTitle(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname && u.pathname !== "/" ? u.pathname : "";
    return `${u.hostname}${path}`;
  } catch {
    return url;
  }
}

interface SafetyResponse {
  ok: boolean;
  verdict?: "safe" | "malicious" | "unknown";
  detail?: string;
}

const NORD_ENDPOINT = "https://link-checker.nordvpn.com/v1/public-url-checker/check-url";

async function handleCheckUrl(url: string): Promise<SafetyResponse> {
  // Defensive timeout — the public endpoint is fast in practice but we
  // shouldn't leave the popover hanging if it doesn't respond.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(NORD_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "application/json" },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false };
    const json = (await res.json()) as Record<string, unknown>;
    return { ok: true, ...normalizeVerdict(json) };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Map provider's response into our normalized shape. The exact JSON schema
 * isn't published; we look at a handful of likely field names and fall back
 * to "unknown" rather than throwing. Real values seen in the wild:
 *   { category: "malicious" | "phishing" | "suspicious" | "trusted" | ... }
 *   { status:   "safe" | "malicious" | ... }
 *   { safe:     boolean }
 */
function normalizeVerdict(json: Record<string, unknown>): Pick<SafetyResponse, "verdict" | "detail"> {
  const raw = (json.category ?? json.status ?? json.verdict ?? json.result ?? "") + "";
  const lc = raw.toLowerCase();
  const isMalicious =
    lc.includes("malic") ||
    lc.includes("phish") ||
    lc.includes("suspici") ||
    lc.includes("danger") ||
    lc.includes("unsafe");
  const isSafe =
    lc === "safe" || lc.includes("trusted") || lc === "ok" || lc === "clean" || json.safe === true;

  let verdict: "safe" | "malicious" | "unknown";
  if (isMalicious) verdict = "malicious";
  else if (isSafe) verdict = "safe";
  else verdict = "unknown";

  const detail = typeof json.message === "string" ? json.message : undefined;
  return { verdict, detail };
}
