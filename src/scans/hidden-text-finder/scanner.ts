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

// Threshold tuning history:
//   v1 used 25, which let any single 30-weight signal flag on its own. That
//   caused a flood of false positives on collapsed accordions, modal
//   drawers parked at left:-9999px, sr-only labels using clip+clip-path,
//   etc. Raised to 40 so a single moderate signal stays below threshold and
//   real hidden text needs corroborating evidence (e.g. low contrast +
//   tiny font, or clipped + zero-size, or offscreen + sr-only NOT present).
const MIN_SCORE = 40;
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

// Common "this is intentionally invisible to sighted users" class-name
// patterns across the major design systems we've encountered in the wild.
// Hits here add a strong negative weight rather than hard-skip so a class
// name typo doesn't accidentally cloak abusive text — but combined with
// the new hard-skips below, legitimate sr-only patterns reliably suppress.
const SR_ONLY_CLASS = /\b(sr-only|sr_only|visually-?hidden|visuallyhidden|screen-?reader|screenreader|screen-reader-text|a11y-only|assistive-text|element-invisible|offscreen|usa-sr-only|govuk-visually-hidden|hidden-visually)\b/i;

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

export interface ScanResult {
  findings: Finding[];
  /** True when the scan hit MAX_TEXT_NODES and stopped early. */
  truncated: boolean;
}

/**
 * Per-scan memoization stores. Background and effective-opacity walks
 * naturally visit every ancestor of every text node — without memoization
 * that's O(N·D²) in the worst case. With these stores it collapses to O(N+D)
 * because each ancestor is computed once and recursive calls hit the cache.
 *
 * `WeakMap` keyed by Element gets garbage-collected automatically when the
 * scan finishes and we drop our local references.
 */
interface ScanContext {
  opacity: WeakMap<Element, number>;
  // null is a valid memoized value — "we tried and the background isn't
  // honestly determinable" (background-image / transparent root). WeakMap
  // can store null; use .has() to distinguish "not computed yet" from
  // "computed to null".
  background: WeakMap<Element, Color | null>;
}

// Returns findings sorted by score desc, plus a truncation flag so the UI
// can show "scan was capped" when a pathologically large DOM hit the budget.
export function scanHiddenText(rootEl: Document | ShadowRoot = document): ScanResult {
  const findings: Finding[] = [];
  const budget = { count: 0 };
  let nextId = 1;
  const seen = new WeakSet<Element>();
  const ctx: ScanContext = {
    opacity: new WeakMap(),
    background: new WeakMap(),
  };

  walkTextNodes(rootEl, (textNode) => {
    const parent = textNode.parentElement;
    if (!parent || seen.has(parent)) return;
    seen.add(parent);

    const finding = inspect(parent, textNode, nextId, ctx);
    if (finding) {
      nextId++;
      findings.push(finding);
    }
  }, budget);

  findings.sort((a, b) => b.score - a.score);
  return { findings, truncated: budget.count >= MAX_TEXT_NODES };
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
    // `element.shadowRoot` is null for *closed* shadow roots — those are
    // unreachable from a content script. The popular community frameworks we
    // care about (kone.gg, Notion-style editors) all use open roots, so this
    // path covers them.
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

function inspect(parent: Element, textNode: Text, id: number, ctx: ScanContext): Finding | null {
  const trimmed = (textNode.textContent ?? "").trim();
  if (trimmed.length < 2) return null;

  const style = window.getComputedStyle(parent);

  // Hard skips: the page is unambiguously hiding this from sighted *and*
  // assistive users, or has marked it as intentional decoration. Either
  // way, it's not "misleadingly hidden" — there's no abuse to surface.
  if (style.display === "none") return null;
  if (style.visibility === "hidden" || style.visibility === "collapse") return null;
  if (parent.closest("[aria-hidden='true']")) return null;
  if (parent.closest("[inert]")) return null;
  if (parent.closest("[hidden]")) return null;
  // role="presentation" / "none" explicitly mark the element as not exposing
  // semantic text — flagging that would just be us second-guessing the author.
  const role = parent.getAttribute("role");
  if (role === "presentation" || role === "none") return null;
  // Classic sr-only *shape* (1×1 clipped + overflow:hidden + position:absolute)
  // catches Tailwind-style inline implementations that omit the conventional
  // class name. If all four ingredients are present, treat as accessibility
  // intent and skip — pattern is too specific to be abusive.
  if (isClassicSrOnlyShape(parent, style)) return null;

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
  const effOpacity = effectiveOpacity(parent, ctx.opacity);
  if (effOpacity < 0.05) {
    reasons.push({ code: "opacity", detail: `effective ${effOpacity.toFixed(3)}`, weight: 45 });
  } else if (effOpacity < 0.2) {
    reasons.push({ code: "opacity", detail: `effective ${effOpacity.toFixed(2)}`, weight: 15 });
  }

  // 3. tiny font — < 1px is structurally invisible; the 5px band was too
  // generous (captions / footnotes legitimately ride that line), demoted.
  const fontSize = parseFloat(style.fontSize);
  if (Number.isFinite(fontSize)) {
    if (fontSize < 1) {
      reasons.push({ code: "tiny-font", detail: `${fontSize}px`, weight: 50 });
    } else if (fontSize < 5) {
      reasons.push({ code: "tiny-font", detail: `${fontSize}px`, weight: 10 });
    }
  }

  // 4. text-indent off-screen — single-signal weight kept moderate; needs
  // corroboration unless the indent is truly extreme.
  const textIndent = parseFloat(style.textIndent);
  if (Number.isFinite(textIndent) && textIndent < -1000) {
    reasons.push({
      code: "offscreen-text-indent",
      detail: `text-indent=${textIndent}px`,
      weight: 20,
    });
  }

  // 5. position absolute/fixed pushed off-screen — modal drawers, slide-in
  // panels, and pre-portal containers routinely park at left:-9999px. Single
  // signal must not flag alone; transitions/animations indicate intent to
  // move into view, so skip those entirely.
  if (style.position === "absolute" || style.position === "fixed") {
    const left = parseFloat(style.left);
    const top = parseFloat(style.top);
    const looksOffscreen = (Number.isFinite(left) && left < -1000) || (Number.isFinite(top) && top < -1000);
    const hasTransition = style.transitionProperty && style.transitionProperty !== "none";
    const hasAnimation = style.animationName && style.animationName !== "none";
    const hasTransform = style.transform && style.transform !== "none";
    if (looksOffscreen && !hasTransition && !hasAnimation && !hasTransform) {
      reasons.push({
        code: "offscreen-position",
        detail: `${style.position} left=${style.left} top=${style.top}`,
        weight: 20,
      });
    }
  }

  // 6. clip / clip-path tricks — both CSS properties match the same intent,
  // so contribute *at most one* clipped reason per element (was previously
  // double-counted, pushing sr-only patterns over threshold).
  const cp = style.clipPath;
  const clip = style.clip;
  const clipPathHidden = cp === "inset(100%)" || cp === "inset(50%)" || cp === "rect(0px, 0px, 0px, 0px)";
  const clipAllZero = clip && clip !== "auto" && /rect\(\s*0(?:px)?[,\s]+\s*0(?:px)?[,\s]+\s*0(?:px)?[,\s]+\s*0(?:px)?\s*\)/.test(clip);
  if (clipPathHidden || clipAllZero) {
    const which = clipPathHidden ? `clip-path=${cp}` : `clip=${clip}`;
    reasons.push({ code: "clipped", detail: which, weight: 25 });
  }

  // 7. zero-size with overflow:hidden — only flag when the element isn't
  // mid-animation. Accordions, tab panels, Headless UI Transition states,
  // and React Spring layouts all briefly show 0×0; skipping during
  // transition/animation removes the bulk of FPs without losing real abuse.
  const rect = parent.getBoundingClientRect();
  const elTransitioning = (style.transitionProperty && style.transitionProperty !== "none") ||
                          (style.animationName && style.animationName !== "none");
  if ((rect.width === 0 || rect.height === 0) && style.overflow === "hidden" && !elTransitioning) {
    reasons.push({
      code: "zero-size",
      detail: `${rect.width}x${rect.height} overflow:hidden`,
      weight: 18,
    });
  }

  // 8. contrast against effective background
  //   - Drop the `< 3` band entirely. WCAG AA fail (between 3 and 4.5) is an
  //     a11y warning, not "intentionally hidden" — flagging legitimate gray
  //     metadata text was the single biggest FP source on normal pages.
  //   - When effectiveBackground can't determine the bg (background-image,
  //     gradient, or all-transparent ancestors), it returns null and we skip
  //     the contrast check rather than fabricate white. Previously assumed
  //     white caused light-text-on-dark-hero to compute contrast ~1.0 and
  //     flag every hero section.
  let contrast: number | null = null;
  let bgStr: string | null = null;
  if (fg && fg.a >= 0.5) {
    const bg = effectiveBackground(parent, ctx.background);
    if (bg) {
      bgStr = formatColor(bg);
      contrast = wcagContrast(fg, bg);
      if (contrast < 1.2) {
        reasons.push({ code: "contrast", detail: `${contrast.toFixed(2)}:1`, weight: 50 });
      } else if (contrast < 1.5) {
        reasons.push({ code: "contrast", detail: `${contrast.toFixed(2)}:1`, weight: 30 });
      }
    }
  }

  // 9. negative weight: legitimate accessibility intent (class-name match).
  // Increased so a class-named sr-only with two corroborating clip/offscreen
  // signals cleanly cancels back below threshold.
  if (looksLikeAccessibilityIntent(parent)) {
    reasons.push({
      code: "aria-intent",
      detail: "sr-only / visually-hidden",
      weight: -40,
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

/**
 * Effective opacity is the product of `opacity` up the ancestor chain. We
 * memoize so the chain for any element is computed exactly once per scan —
 * `effectiveOpacity(parent) === own_opacity * effectiveOpacity(grandparent)`
 * means each ancestor's contribution is reused by every descendant.
 */
function effectiveOpacity(el: Element, memo: WeakMap<Element, number>): number {
  const cached = memo.get(el);
  if (cached !== undefined) return cached;

  const cs = window.getComputedStyle(el);
  const own = parseFloat(cs.opacity);
  const ownClamped = Number.isFinite(own) ? own : 1;
  const parent = el.parentElement;
  const result = parent ? ownClamped * effectiveOpacity(parent, memo) : ownClamped;
  memo.set(el, result);
  return result;
}

/**
 * First ancestor whose backgroundColor is non-transparent, composited with
 * its own ancestor background if it's semi-transparent.
 *
 * Returns `null` when we cannot honestly determine the background — i.e.:
 *   - some ancestor in the chain uses `background-image` / a gradient
 *     (computed `backgroundImage !== "none"`), or
 *   - we reach `<html>` with everything transparent (likely a dark color
 *     scheme drawn by the UA, which getComputedStyle reports as transparent).
 *
 * Earlier versions assumed a white fallback in those cases. That made light
 * text on hero images, gradients, dark-mode pages, and `color-scheme: dark`
 * compute as ~1.0 contrast on imagined white, flagging the whole page. The
 * contrast branch in `inspect()` now skips entirely when this returns null.
 *
 * Memoized: each ancestor is computed once per scan.
 */
function effectiveBackground(el: Element, memo: WeakMap<Element, Color | null>): Color | null {
  if (memo.has(el)) return memo.get(el) ?? null;

  const cs = window.getComputedStyle(el);
  // A background-image (including gradients) means we can't compute contrast
  // against a single solid color — pixel sampling would be required, which
  // we explicitly opted out of for v1.
  if (cs.backgroundImage && cs.backgroundImage !== "none") {
    memo.set(el, null);
    return null;
  }

  const bg = parseColor(cs.backgroundColor);
  const parent = el.parentElement;

  let result: Color | null;
  if (bg && bg.a >= 0.95) {
    result = bg;
  } else if (!parent) {
    // Hit the documentElement with nothing opaque. Could be the UA canvas
    // (typically white, but the user's color-scheme might draw it dark);
    // safer to admit ignorance than to fabricate white.
    result = null;
  } else {
    const parentBg = effectiveBackground(parent, memo);
    if (!parentBg) {
      result = null;
    } else if (bg && bg.a > 0.05) {
      result = composite(bg, parentBg);
    } else {
      result = parentBg;
    }
  }
  memo.set(el, result);
  return result;
}

/**
 * The canonical "visually-hidden" CSS recipe distilled into a shape match:
 * 1×1 element, overflow hidden, absolutely positioned, with a clip rule.
 * Used to suppress sr-only patterns that don't carry the conventional class
 * name (Tailwind inline implementations, custom design systems).
 */
function isClassicSrOnlyShape(el: Element, style: CSSStyleDeclaration): boolean {
  if (style.position !== "absolute" && style.position !== "fixed") return false;
  if (style.overflow !== "hidden") return false;
  const rect = el.getBoundingClientRect();
  if (rect.width > 2 || rect.height > 2) return false;
  const hasClip =
    (style.clip && style.clip !== "auto") ||
    (style.clipPath && style.clipPath !== "none");
  return Boolean(hasClip);
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
