/**
 * Pure scan logic — no DOM mutation, no rendering. Walks every text node in
 * the document (descending into open shadow roots) and scores each parent
 * element against a handful of "is this text actually visible?" signals.
 *
 * Signals are additive weights. The final score is clamped to 0–100 and
 * findings below MIN_SCORE are dropped. Negative weights model "accessibility
 * intent" (sr-only / visually-hidden patterns) so a legitimately-hidden
 * screen-reader label is naturally suppressed rather than hard-filtered.
 */

const MIN_SCORE = 25;
// Safety budget — even huge pages typically have fewer than a few thousand
// text nodes; this guards against truly pathological DOM trees.
const MAX_TEXT_NODES = 50_000;

const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "META",
  "LINK",
  "HEAD",
  "TITLE",
  "SVG",
  "PATH",
  "IFRAME",
]);

const SR_ONLY_CLASS = /\b(sr-only|sr_only|visually-?hidden|visuallyhidden|screen-?reader|screenreader|a11y-only)\b/i;

export interface Reason {
  code:
    | "contrast"
    | "color-transparent"
    | "opacity"
    | "tiny-font"
    | "offscreen-text-indent"
    | "offscreen-position"
    | "clipped"
    | "zero-size"
    | "aria-intent";
  detail: string;
  weight: number;
}

export interface Finding {
  id: number;
  element: Element;
  text: string;
  fullText: string;
  /** Page-coordinate rect (viewport rect + scroll offset) captured at scan time. */
  pageRect: { top: number; left: number; width: number; height: number };
  reasons: Reason[];
  score: number;
  fg: string;
  bg: string | null;
  contrast: number | null;
}

interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

// Returns all findings, sorted by score desc.
export function scanHiddenText(rootEl: Document | ShadowRoot = document): Finding[] {
  const findings: Finding[] = [];
  const budget = { count: 0 };
  let nextId = 1;
  const seen = new WeakSet<Element>();

  walkTextNodes(rootEl, (textNode) => {
    const parent = textNode.parentElement;
    if (!parent || seen.has(parent)) return;
    seen.add(parent);

    const finding = inspect(parent, textNode, nextId);
    if (finding) {
      nextId++;
      findings.push(finding);
    }
  }, budget);

  findings.sort((a, b) => b.score - a.score);
  return findings;
}

function walkTextNodes(
  root: Node,
  visit: (t: Text) => void,
  budget: { count: number }
): void {
  if (budget.count >= MAX_TEXT_NODES) return;

  if (root instanceof Element) {
    if (SKIP_TAGS.has(root.tagName)) return;
    // Skip our own UI's shadow root, recognized by host id.
    if (root.id === "__sincerity_tools_host__") return;
    if (root.shadowRoot) walkTextNodes(root.shadowRoot, visit, budget);
  }

  for (const child of Array.from(root.childNodes)) {
    if (budget.count >= MAX_TEXT_NODES) return;

    if (child.nodeType === Node.TEXT_NODE) {
      budget.count++;
      visit(child as Text);
    } else if (child.nodeType === Node.ELEMENT_NODE || child.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      walkTextNodes(child, visit, budget);
    }
  }
}

function inspect(parent: Element, textNode: Text, id: number): Finding | null {
  const trimmed = (textNode.textContent ?? "").trim();
  if (trimmed.length < 2) return null;

  const style = window.getComputedStyle(parent);

  // Hard skip: not rendered at all. We're hunting *misleadingly hidden* text,
  // not text the page itself chose to omit from the render tree.
  if (style.display === "none" || style.visibility === "hidden") return null;

  const reasons: Reason[] = [];

  // 1. color: transparent / alpha very low
  const fg = parseColor(style.color);
  if (fg && fg.a < 0.1) {
    reasons.push({
      code: "color-transparent",
      detail: `color alpha=${fg.a.toFixed(2)}`,
      weight: 50,
    });
  }

  // 2. effective opacity (composed up the ancestor chain)
  const effOpacity = effectiveOpacity(parent);
  if (effOpacity < 0.05) {
    reasons.push({ code: "opacity", detail: `effective ${effOpacity.toFixed(3)}`, weight: 40 });
  } else if (effOpacity < 0.2) {
    reasons.push({ code: "opacity", detail: `effective ${effOpacity.toFixed(2)}`, weight: 20 });
  }

  // 3. tiny font
  const fontSize = parseFloat(style.fontSize);
  if (Number.isFinite(fontSize)) {
    if (fontSize < 1) {
      reasons.push({ code: "tiny-font", detail: `${fontSize}px`, weight: 50 });
    } else if (fontSize < 5) {
      reasons.push({ code: "tiny-font", detail: `${fontSize}px`, weight: 20 });
    }
  }

  // 4. text-indent off-screen
  const textIndent = parseFloat(style.textIndent);
  if (Number.isFinite(textIndent) && textIndent < -1000) {
    reasons.push({
      code: "offscreen-text-indent",
      detail: `text-indent=${textIndent}px`,
      weight: 30,
    });
  }

  // 5. position absolute/fixed pushed off-screen
  if (style.position === "absolute" || style.position === "fixed") {
    const left = parseFloat(style.left);
    const top = parseFloat(style.top);
    if ((Number.isFinite(left) && left < -1000) || (Number.isFinite(top) && top < -1000)) {
      reasons.push({
        code: "offscreen-position",
        detail: `${style.position} left=${style.left} top=${style.top}`,
        weight: 30,
      });
    }
  }

  // 6. clip / clip-path tricks
  const cp = style.clipPath;
  if (cp === "inset(100%)" || cp === "inset(50%)" || cp === "rect(0px, 0px, 0px, 0px)") {
    reasons.push({ code: "clipped", detail: `clip-path=${cp}`, weight: 30 });
  }
  // clip is deprecated but still respected by browsers — sr-only's classic recipe.
  const clip = style.clip;
  if (clip && clip !== "auto" && /rect\(\s*0(?:px)?[, ]/.test(clip)) {
    reasons.push({ code: "clipped", detail: `clip=${clip}`, weight: 30 });
  }

  // 7. zero-size with overflow:hidden
  const rect = parent.getBoundingClientRect();
  if ((rect.width === 0 || rect.height === 0) && style.overflow === "hidden") {
    reasons.push({
      code: "zero-size",
      detail: `${rect.width}x${rect.height} overflow:hidden`,
      weight: 25,
    });
  }

  // 8. contrast against effective background
  let contrast: number | null = null;
  let bgStr: string | null = null;
  if (fg && fg.a >= 0.5) {
    const bg = effectiveBackground(parent);
    if (bg) {
      bgStr = formatColor(bg);
      contrast = wcagContrast(fg, bg);
      if (contrast < 1.2) {
        reasons.push({ code: "contrast", detail: `${contrast.toFixed(2)}:1`, weight: 50 });
      } else if (contrast < 1.5) {
        reasons.push({ code: "contrast", detail: `${contrast.toFixed(2)}:1`, weight: 35 });
      } else if (contrast < 3) {
        reasons.push({ code: "contrast", detail: `${contrast.toFixed(2)}:1`, weight: 15 });
      }
    }
  }

  // 9. negative weight: legitimate accessibility intent
  if (looksLikeAccessibilityIntent(parent)) {
    reasons.push({
      code: "aria-intent",
      detail: "sr-only / visually-hidden",
      weight: -25,
    });
  }

  if (reasons.length === 0) return null;

  const raw = reasons.reduce((s, r) => s + r.weight, 0);
  const score = Math.max(0, Math.min(100, raw));
  if (score < MIN_SCORE) return null;

  const pageRect = {
    top: rect.top + window.scrollY,
    left: rect.left + window.scrollX,
    width: rect.width,
    height: rect.height,
  };

  return {
    id,
    element: parent,
    text: trimmed.length > 140 ? trimmed.slice(0, 140) + "…" : trimmed,
    fullText: trimmed,
    pageRect,
    reasons,
    score,
    fg: fg ? formatColor(fg) : style.color,
    bg: bgStr,
    contrast,
  };
}

// ----- helpers: color, contrast, ancestor walks -----

function parseColor(input: string | null | undefined): Color | null {
  if (!input) return null;
  // getComputedStyle returns rgb()/rgba() in Chrome.
  const m = input.match(/rgba?\(([^)]+)\)/i);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const r = clampByte(parseFloat(parts[0]));
  const g = clampByte(parseFloat(parts[1]));
  const b = clampByte(parseFloat(parts[2]));
  const a = parts.length >= 4 ? clamp01(parseFloat(parts[3])) : 1;
  return { r, g, b, a };
}

function formatColor(c: Color): string {
  if (c.a >= 0.999) return `rgb(${c.r}, ${c.g}, ${c.b})`;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a.toFixed(2)})`;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 1;
  return Math.max(0, Math.min(1, x));
}

function clampByte(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(255, Math.round(x)));
}

function effectiveOpacity(el: Element): number {
  let cur: Element | null = el;
  let o = 1;
  while (cur) {
    const cs = window.getComputedStyle(cur);
    const v = parseFloat(cs.opacity);
    if (Number.isFinite(v)) o *= v;
    cur = cur.parentElement;
  }
  return o;
}

/**
 * First ancestor whose backgroundColor is non-transparent, composited with
 * its own ancestor background if it's semi-transparent. Falls back to white
 * when nothing opaque is found (matches the browser's default canvas).
 */
function effectiveBackground(el: Element): Color | null {
  let cur: Element | null = el;
  while (cur) {
    const cs = window.getComputedStyle(cur);
    const bg = parseColor(cs.backgroundColor);
    if (bg && bg.a > 0.05) {
      if (bg.a >= 0.95) return bg;
      const parentBg: Color =
        (cur.parentElement && effectiveBackground(cur.parentElement)) ??
        { r: 255, g: 255, b: 255, a: 1 };
      return composite(bg, parentBg);
    }
    cur = cur.parentElement;
  }
  return { r: 255, g: 255, b: 255, a: 1 };
}

// Alpha composite "src over dst" — assumes dst is opaque.
function composite(src: Color, dst: Color): Color {
  const a = src.a;
  return {
    r: Math.round(src.r * a + dst.r * (1 - a)),
    g: Math.round(src.g * a + dst.g * (1 - a)),
    b: Math.round(src.b * a + dst.b * (1 - a)),
    a: 1,
  };
}

// WCAG 2.x contrast ratio.
function wcagContrast(a: Color, b: Color): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

function luminance(c: Color): number {
  const r = sRgbToLinear(c.r / 255);
  const g = sRgbToLinear(c.g / 255);
  const b = sRgbToLinear(c.b / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function sRgbToLinear(channel: number): number {
  return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function looksLikeAccessibilityIntent(el: Element): boolean {
  let cur: Element | null = el;
  while (cur) {
    const cls = typeof cur.className === "string" ? cur.className : "";
    if (SR_ONLY_CLASS.test(cls)) return true;
    cur = cur.parentElement;
  }
  return false;
}
