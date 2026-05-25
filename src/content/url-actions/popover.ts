/**
 * Custom popover for the URL-on-dblclick flow.
 *
 * Differs from src/content/popover.ts in two ways that warrant a separate
 * component instead of overloading the existing one:
 *
 *  - Async sections. The phishing-check result arrives later; the popover
 *    has to start with a "checking…" placeholder and swap in the verdict
 *    when the background script responds. The generic ToolResult API is
 *    one-shot synchronous.
 *
 *  - Mixed actions. 열기 / 북마크 / 복사 sit alongside inspector warnings
 *    and the safety-check verdict, all rendered in a single panel rather
 *    than a header + body + footer split.
 */
import { ensureRoot } from "../root";
import { collectWarnings } from "./inspector";

export interface UrlPopoverAnchor {
  pageX: number;
  pageY: number;
  pageBottom: number;
}

export interface ShowUrlPopoverOpts {
  url: string;
  anchor: UrlPopoverAnchor;
}

let current: HTMLDivElement | null = null;

export function showUrlPopover(opts: ShowUrlPopoverOpts): void {
  hideUrlPopover();

  const root = ensureRoot();
  const u = safeParse(opts.url);
  if (!u) return;

  const el = document.createElement("div");
  el.className = "url-pop";
  el.style.pointerEvents = "auto";
  el.style.visibility = "hidden";
  el.style.top = "0px";
  el.style.left = "0px";

  el.appendChild(buildHeader(u, opts.url));
  el.appendChild(buildActions(opts.url));
  const warnSection = buildWarnings(u);
  if (warnSection) el.appendChild(warnSection);

  const safetyWrap = document.createElement("div");
  safetyWrap.className = "url-pop-safety-wrap";
  safetyWrap.appendChild(buildSafetyRow("nordvpn", "NordVPN"));
  safetyWrap.appendChild(buildSafetyRow("rancert", "Rancert"));
  el.appendChild(safetyWrap);

  el.appendChild(buildAttribution());

  root.appendChild(el);

  // Position — same math as the generic popover.
  const { width } = el.getBoundingClientRect();
  const margin = 8;
  const left = Math.max(margin, opts.anchor.pageX - width / 2);
  const top = opts.anchor.pageBottom + margin;
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
  el.style.visibility = "";

  current = el;

  // Fire async safety checks in parallel; each row updates independently.
  void runNordvpnCheck(opts.url, el);
  void runRancertCheck(opts.url, el);
}

export function hideUrlPopover(): void {
  if (current?.parentNode) current.parentNode.removeChild(current);
  current = null;
}

export function isUrlPopoverOpen(): boolean {
  return current !== null;
}

// --------- sections ---------

function buildHeader(u: URL, fullUrl: string): HTMLDivElement {
  const head = document.createElement("div");
  head.className = "url-pop-header";

  const title = document.createElement("div");
  title.className = "url-pop-title";
  const host = document.createElement("strong");
  host.textContent = u.hostname;
  title.appendChild(host);
  if (u.pathname && u.pathname !== "/") {
    const path = document.createElement("span");
    path.className = "url-pop-path";
    path.textContent = truncatePath(u.pathname + u.search + u.hash);
    title.appendChild(path);
  }
  title.title = fullUrl;

  const close = document.createElement("button");
  close.type = "button";
  close.className = "url-pop-close";
  close.setAttribute("aria-label", "닫기");
  close.textContent = "×";
  close.addEventListener("mousedown", (e) => e.preventDefault());
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    hideUrlPopover();
  });

  head.appendChild(title);
  head.appendChild(close);
  return head;
}

function buildActions(url: string): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "url-pop-actions";

  row.appendChild(actionBtn({
    label: "열기",
    primary: true,
    onClick: () => {
      window.open(url, "_blank", "noopener,noreferrer");
      hideUrlPopover();
    },
  }));

  const bookmarkBtn = actionBtn({
    label: "북마크 추가",
    onClick: async () => {
      bookmarkBtn.disabled = true;
      try {
        // Optional permission: the install-time prompt skipped 'bookmarks',
        // so we request it on first use. chrome.permissions.request must run
        // inside a user-gesture context — the click handler IS that context,
        // which is why this lives in the content script and not the
        // background service worker (gestures don't survive sendMessage in MV3).
        const hasIt = await chrome.permissions.contains({ permissions: ["bookmarks"] });
        if (!hasIt) {
          const granted = await chrome.permissions.request({ permissions: ["bookmarks"] });
          if (!granted) {
            bookmarkBtn.textContent = "권한 거부";
            bookmarkBtn.classList.add("err");
            bookmarkBtn.disabled = false;
            return;
          }
        }
        const res = await sendMessage<{ ok: boolean; reason?: string }>({
          type: "sincerity:bookmark-add",
          url,
        });
        if (res?.ok) {
          bookmarkBtn.textContent = "추가됨";
          bookmarkBtn.classList.add("done");
        } else {
          bookmarkBtn.textContent = res?.reason === "permission-denied" ? "권한 거부" : "실패";
          bookmarkBtn.classList.add("err");
          bookmarkBtn.disabled = false;
        }
      } catch {
        bookmarkBtn.textContent = "실패";
        bookmarkBtn.classList.add("err");
        bookmarkBtn.disabled = false;
      }
    },
  });
  row.appendChild(bookmarkBtn);

  const copyBtn = actionBtn({
    label: "복사",
    onClick: async () => {
      try {
        await navigator.clipboard.writeText(url);
        copyBtn.textContent = "복사됨";
        copyBtn.classList.add("done");
        setTimeout(() => {
          copyBtn.textContent = "복사";
          copyBtn.classList.remove("done");
        }, 1200);
      } catch {
        copyBtn.textContent = "실패";
      }
    },
  });
  row.appendChild(copyBtn);

  return row;
}

function buildWarnings(u: URL): HTMLDivElement | null {
  const warnings = collectWarnings(u);
  if (warnings.length === 0) return null;
  const wrap = document.createElement("div");
  wrap.className = "url-pop-warn";
  for (const w of warnings) {
    const row = document.createElement("div");
    row.className = "url-pop-warn-row";
    row.textContent = w;
    wrap.appendChild(row);
  }
  return wrap;
}

function buildSafetyRow(provider: "nordvpn" | "rancert", label: string): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "url-pop-safety pending";
  wrap.dataset.provider = provider;
  // CSS spinner instead of an emoji so the loading state actually animates
  // and looks distinct from "no result yet" emoji placeholders.
  wrap.innerHTML = `
    <div class="url-pop-safety-head">
      <span class="url-pop-safety-icon"><span class="url-pop-spinner"></span></span>
      <span class="url-pop-safety-provider">${label}</span>
      <span class="url-pop-safety-label">검사 중…</span>
    </div>
  `;
  return wrap;
}

function buildAttribution(): HTMLDivElement {
  const f = document.createElement("div");
  f.className = "url-pop-attrib";
  f.textContent = "Powered by NordVPN · Rancert (한국랜섬웨어침해대응센터)";
  return f;
}

// --------- async safety checks ---------

type CheckError = "timeout" | "network" | "rate_limit" | "http" | "parse" | "unknown";

interface NordvpnResponse {
  ok: boolean;
  verdict?: "safe" | "malicious" | "unknown";
  detail?: string;
  error?: CheckError;
}

interface RancertResponse {
  ok: boolean;
  verdict?: "safe" | "malicious" | "unknown";
  summary?: string;
  counts?: { clean: number; unrated: number; suspicious: number; malicious: number; total: number };
  error?: CheckError;
}

// Client-side timeout — slightly longer than each background fetch's own
// timeout so the background's classified error reaches us first. Acts as a
// last-resort guard against an MV3 service worker eviction that drops our
// sendMessage promise on the floor (would otherwise spin forever).
const CLIENT_TIMEOUT_MS = 12_000;

async function runNordvpnCheck(url: string, popover: HTMLDivElement): Promise<void> {
  const section = popover.querySelector<HTMLDivElement>('[data-provider="nordvpn"]');
  if (!section) return;
  let res: NordvpnResponse;
  try {
    res = await sendMessageWithTimeout<NordvpnResponse>(
      { type: "sincerity:check-url", url },
      CLIENT_TIMEOUT_MS
    );
  } catch (e) {
    res = { ok: false, error: e instanceof TimeoutError ? "timeout" : "network" };
  }
  if (popover !== current) return;
  renderProviderRow(section, "NordVPN", res, res.detail);
}

async function runRancertCheck(url: string, popover: HTMLDivElement): Promise<void> {
  const section = popover.querySelector<HTMLDivElement>('[data-provider="rancert"]');
  if (!section) return;
  let res: RancertResponse;
  try {
    res = await sendMessageWithTimeout<RancertResponse>(
      { type: "sincerity:check-url-rancert", url },
      CLIENT_TIMEOUT_MS
    );
  } catch (e) {
    res = { ok: false, error: e instanceof TimeoutError ? "timeout" : "network" };
  }
  if (popover !== current) return;
  renderProviderRow(section, "Rancert", res, res.summary);
}

interface BasicResponse {
  ok: boolean;
  verdict?: "safe" | "malicious" | "unknown";
  error?: CheckError;
}

function renderProviderRow(
  section: HTMLDivElement,
  provider: string,
  res: BasicResponse,
  detail: string | undefined
): void {
  section.classList.remove("pending", "safe", "danger", "unknown", "error");

  if (!res.ok) {
    section.classList.add("error");
    const { label, hint } = labelsForError(res.error);
    const hintHtml = hint ? `<div class="url-pop-safety-detail">${escapeHtml(hint)}</div>` : "";
    section.innerHTML = `
      <div class="url-pop-safety-head">
        <span class="url-pop-safety-icon">!</span>
        <span class="url-pop-safety-provider">${escapeHtml(provider)}</span>
        <span class="url-pop-safety-label">${escapeHtml(label)}</span>
      </div>
      ${hintHtml}
    `;
    return;
  }

  const verdict = res.verdict ?? "unknown";
  const cls = verdict === "safe" ? "safe" : verdict === "malicious" ? "danger" : "unknown";
  const icon = verdict === "safe" ? "✓" : verdict === "malicious" ? "⚠" : "?";
  const label =
    verdict === "safe" ? "안전" : verdict === "malicious" ? "위험 신호" : "판정 보류";
  section.classList.add(cls);
  const detailHtml = detail ? `<div class="url-pop-safety-detail">${escapeHtml(detail)}</div>` : "";
  section.innerHTML = `
    <div class="url-pop-safety-head">
      <span class="url-pop-safety-icon">${icon}</span>
      <span class="url-pop-safety-provider">${escapeHtml(provider)}</span>
      <span class="url-pop-safety-label">${label}</span>
    </div>
    ${detailHtml}
  `;
}

function labelsForError(error: CheckError | undefined): { label: string; hint?: string } {
  switch (error) {
    case "timeout":
      return { label: "응답 시간 초과", hint: "잠시 후 다시 시도해 주세요." };
    case "network":
      return { label: "연결 오류", hint: "네트워크 상태를 확인해 주세요." };
    case "rate_limit":
      return { label: "요청 한도 초과", hint: "잠시 후 다시 시도해 주세요." };
    case "http":
      return { label: "서버 응답 오류" };
    case "parse":
      return { label: "응답 해석 실패" };
    default:
      return { label: "검사 일시적 불가" };
  }
}

class TimeoutError extends Error {
  constructor() {
    super("client-timeout");
    this.name = "TimeoutError";
  }
}

function sendMessageWithTimeout<T>(msg: unknown, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new TimeoutError());
    }, ms);
    try {
      chrome.runtime.sendMessage(msg, (response: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(response as T);
      });
    } catch (e) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

// --------- helpers ---------

interface ActionBtnOpts {
  label: string;
  primary?: boolean;
  onClick: () => void | Promise<void>;
}

function actionBtn(opts: ActionBtnOpts): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "url-pop-btn" + (opts.primary ? " primary" : "");
  b.textContent = opts.label;
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    void opts.onClick();
  });
  return b;
}

function truncatePath(s: string): string {
  if (s.length <= 32) return s;
  return s.slice(0, 30) + "…";
}

function safeParse(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sendMessage<T>(msg: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(msg, (response) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(response as T);
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}
