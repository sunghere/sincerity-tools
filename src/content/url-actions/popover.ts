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
  wrap.innerHTML = `
    <div class="url-pop-safety-head">
      <span class="url-pop-safety-icon">⏳</span>
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

interface NordvpnResponse {
  ok: boolean;
  verdict?: "safe" | "malicious" | "unknown";
  detail?: string;
}

interface RancertResponse {
  ok: boolean;
  verdict?: "safe" | "malicious" | "unknown";
  summary?: string;
  counts?: { clean: number; unrated: number; suspicious: number; malicious: number; total: number };
}

async function runNordvpnCheck(url: string, popover: HTMLDivElement): Promise<void> {
  const section = popover.querySelector<HTMLDivElement>('[data-provider="nordvpn"]');
  if (!section) return;
  let res: NordvpnResponse | null = null;
  try {
    res = await sendMessage<NordvpnResponse>({ type: "sincerity:check-url", url });
  } catch {
    res = { ok: false };
  }
  if (popover !== current) return;
  renderVerdictRow(section, "NordVPN", res?.ok ? res.verdict : undefined, res?.detail);
}

async function runRancertCheck(url: string, popover: HTMLDivElement): Promise<void> {
  const section = popover.querySelector<HTMLDivElement>('[data-provider="rancert"]');
  if (!section) return;
  let res: RancertResponse | null = null;
  try {
    res = await sendMessage<RancertResponse>({ type: "sincerity:check-url-rancert", url });
  } catch {
    res = { ok: false };
  }
  if (popover !== current) return;
  renderVerdictRow(section, "Rancert", res?.ok ? res.verdict : undefined, res?.summary);
}

function renderVerdictRow(
  section: HTMLDivElement,
  provider: string,
  verdict: "safe" | "malicious" | "unknown" | undefined,
  detail: string | undefined
): void {
  section.classList.remove("pending");
  if (verdict === undefined) {
    section.classList.add("unknown");
    section.innerHTML = `
      <div class="url-pop-safety-head">
        <span class="url-pop-safety-icon">?</span>
        <span class="url-pop-safety-provider">${escapeHtml(provider)}</span>
        <span class="url-pop-safety-label">검사 일시적 불가</span>
      </div>
    `;
    return;
  }
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
