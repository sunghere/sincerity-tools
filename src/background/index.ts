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

  if (m.type === "sincerity:check-url-rancert" && typeof m.url === "string") {
    handleCheckUrlRancert(m.url).then(sendResponse);
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

/**
 * Machine-readable failure reasons so the content-script popover can show a
 * specific message (network vs timeout vs rate-limit etc) instead of one
 * generic "검사 불가". `unknown` is the catch-all when we genuinely don't
 * know what went wrong.
 */
export type CheckError =
  | "timeout"        // AbortController fired
  | "network"        // fetch() rejected (DNS, offline, TLS, etc.)
  | "rate_limit"     // HTTP 429
  | "http"           // any other non-2xx
  | "parse"          // 2xx but body didn't shape into a verdict
  | "unknown";

interface SafetyResponse {
  ok: boolean;
  verdict?: "safe" | "malicious" | "unknown";
  detail?: string;
  error?: CheckError;
}

const NORD_ENDPOINT = "https://link-checker.nordvpn.com/v1/public-url-checker/check-url";
const NORD_TIMEOUT_MS = 6000;

async function handleCheckUrl(url: string): Promise<SafetyResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NORD_TIMEOUT_MS);
  try {
    const res = await fetch(NORD_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "application/json" },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });
    if (res.status === 429) return { ok: false, error: "rate_limit" };
    if (!res.ok) return { ok: false, error: "http" };
    let json: Record<string, unknown>;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      return { ok: false, error: "parse" };
    }
    return { ok: true, ...normalizeVerdict(json) };
  } catch (e) {
    return { ok: false, error: classifyFetchError(e) };
  } finally {
    clearTimeout(timer);
  }
}

function classifyFetchError(e: unknown): CheckError {
  if (e instanceof Error) {
    if (e.name === "AbortError") return "timeout";
    if (e.name === "TypeError") return "network"; // fetch's generic offline/CORS/DNS
  }
  return "unknown";
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

// ---- Rancert (한국랜섬웨어침해대응센터) ----
//
// Endpoint returns an HTML page that wraps a VirusTotal-style aggregation
// table — ~60 URL-scanner engines, each labelled "clean site" / "unrated site"
// / "malicious" / "phishing" / etc. We scrape the table with a regex (service
// workers don't have DOMParser) and aggregate the engine counts.
//
// Rate limit: the site says 4 requests / minute, but that's per client IP —
// we POST from the user's browser, not a shared server, so a normal user
// dblclicking URLs won't hit it. A 429 / partial page just turns into an
// "unknown" verdict downstream.

const RANCERT_ENDPOINT = "https://www.rancert.com/virustotal_url_result.php";
const RANCERT_REFERER = "https://www.rancert.com/check_url.php";

interface RancertResponse {
  ok: boolean;
  verdict?: "safe" | "malicious" | "unknown";
  /** Compact summary like "60/60 clean" or "2 malicious · 58 clean". */
  summary?: string;
  /** Per-bucket engine counts; useful for the popover detail line. */
  counts?: { clean: number; unrated: number; suspicious: number; malicious: number; total: number };
  error?: CheckError;
}

const RANCERT_TIMEOUT_MS = 8000;

async function handleCheckUrlRancert(url: string): Promise<RancertResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RANCERT_TIMEOUT_MS);
  try {
    const body = `p=u&strUrl=${encodeURIComponent(url)}`;
    const res = await fetch(RANCERT_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        // Server checks the referer to gate the endpoint — without it the
        // POST gets a generic page instead of a result.
        "referer": RANCERT_REFERER,
      },
      body,
      signal: controller.signal,
    });
    if (res.status === 429) return { ok: false, error: "rate_limit" };
    if (!res.ok) return { ok: false, error: "http" };
    const html = await res.text();
    return parseRancertHtml(html);
  } catch (e) {
    return { ok: false, error: classifyFetchError(e) };
  } finally {
    clearTimeout(timer);
  }
}

// Pulled out for unit-testability and so the regex shape is easy to find.
const RANCERT_ROW_RE = /<td class="leftPadd">([^<]+)<\/td>\s*<td>([^<]+)<\/td>/g;

function parseRancertHtml(html: string): RancertResponse {
  const counts = { clean: 0, unrated: 0, suspicious: 0, malicious: 0, total: 0 };
  for (const m of html.matchAll(RANCERT_ROW_RE)) {
    const result = m[2].trim().toLowerCase();
    counts.total++;
    if (result.includes("malic") || result.includes("phish") || result.includes("unsafe") || result.includes("danger")) {
      counts.malicious++;
    } else if (result.includes("suspici")) {
      counts.suspicious++;
    } else if (result === "clean site" || result.includes("harmless") || result === "clean") {
      counts.clean++;
    } else {
      // Includes "unrated site", "no rating", anything we don't explicitly bucket.
      counts.unrated++;
    }
  }
  if (counts.total === 0) {
    // Server returned a non-result page — typically the rate-limit landing
    // page (no 429 status, just plain HTML without the table). Surface as
    // a parse failure so the popover can hint at "응답 해석 실패" — and
    // pre-emptively map the most common cause for the user.
    return { ok: false, error: "parse" };
  }

  // Any malicious engine wins — even one phishing flag is worth surfacing.
  // Suspicious-only is "unknown" (something noticed *something*, but no hard
  // hit). Otherwise: if any engine actively cleared the URL, call it safe;
  // if every engine was unrated, stay unknown (no provider weighed in).
  let verdict: "safe" | "malicious" | "unknown";
  if (counts.malicious > 0) verdict = "malicious";
  else if (counts.suspicious > 0) verdict = "unknown";
  else if (counts.clean > 0) verdict = "safe";
  else verdict = "unknown";

  const summary =
    counts.malicious > 0
      ? `${counts.malicious} 위험 · ${counts.clean} 안전 / 전체 ${counts.total}`
      : counts.suspicious > 0
      ? `${counts.suspicious} 의심 · ${counts.clean} 안전 / 전체 ${counts.total}`
      : `${counts.clean}/${counts.total} 안전`;

  return { ok: true, verdict, summary, counts };
}
