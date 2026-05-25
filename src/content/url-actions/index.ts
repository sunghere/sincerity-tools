/**
 * Public entry for the URL-on-dblclick flow. Imported by `src/content/index.ts`
 * to install the listener; everything else is self-contained.
 *
 * Top frame only. The content script runs in every frame via
 * `all_frames: true`, but spawning the popover inside an ad iframe would
 *   (a) render the popover inside a small/clipped frame the user can't see,
 *   (b) leak the iframe's URL to the safety providers, and
 *   (c) widen the attack surface — a hostile iframe could induce arbitrary
 *       URL safety checks (low impact, but no upside).
 * Selecting text inside an iframe still works via the regular selection
 * toolbar; the dblclick affordance just stays out of child frames.
 */
import { detectUrlAt } from "./detector";
import { hideUrlPopover, showUrlPopover, isUrlPopoverOpen } from "./popover";
import { ensureRoot, isInsideOurUI } from "../root";

/**
 * Window inside which a dblclick-set suppression flag is still considered
 * fresh. The flag is consumed by the next selection-toolbar attempt (which
 * runs via setTimeout(0)), so anything past one event-loop turn is stale.
 * 200ms is comfortably bigger than the turnaround and small enough that a
 * later unrelated selection never inherits a leftover flag.
 */
const SUPPRESS_TTL_MS = 200;

/**
 * Installs the dblclick handler in the top frame only and returns a probe
 * the selection-toolbar path can consult to skip painting on top of us.
 *
 * In child frames the probe always returns false (no-op installation), so
 * the selection toolbar continues to work normally there.
 */
export function installUrlDblclickHandler(): { shouldSuppressToolbar: () => boolean } {
  let suppressedAt = 0;

  // Cross-origin top-frame check — guard the property access in case some
  // sandboxed iframe configuration throws on `window.top`.
  let isTopFrame: boolean;
  try {
    isTopFrame = window.top === window;
  } catch {
    isTopFrame = false;
  }
  if (!isTopFrame) {
    return { shouldSuppressToolbar: () => false };
  }

  document.addEventListener("dblclick", (e: MouseEvent) => {
    if (isInsideOurUI(e.target)) return;
    const detected = detectUrlAt(e);
    if (!detected) return;

    suppressedAt = Date.now();
    ensureRoot();

    const r = detected.rect;
    const anchor = {
      pageX: r.left + window.scrollX + r.width / 2,
      pageY: r.top + window.scrollY,
      pageBottom: r.bottom + window.scrollY,
    };

    showUrlPopover({ url: detected.url, anchor });
  }, true);

  return {
    shouldSuppressToolbar: () => {
      const fresh = suppressedAt !== 0 && Date.now() - suppressedAt < SUPPRESS_TTL_MS;
      suppressedAt = 0;
      return fresh;
    },
  };
}

export { hideUrlPopover, isUrlPopoverOpen };
