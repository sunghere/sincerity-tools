/**
 * Public entry for the URL-on-dblclick flow. Imported by `src/content/index.ts`
 * to install the listener; everything else is self-contained.
 */
import { detectUrlAt } from "./detector";
import { hideUrlPopover, showUrlPopover, isUrlPopoverOpen } from "./popover";
import { ensureRoot, isInsideOurUI } from "../root";

/**
 * Installs the dblclick handler. Returns a "should suppress next selection
 * toolbar" probe — content/index.ts checks it inside the setTimeout that
 * normally shows the toolbar, so we don't paint two UIs on top of each other
 * when the user dblclicked on a URL.
 */
export function installUrlDblclickHandler(): { shouldSuppressToolbar: () => boolean } {
  let suppressOnce = false;

  document.addEventListener("dblclick", (e: MouseEvent) => {
    if (isInsideOurUI(e.target)) return;
    const detected = detectUrlAt(e);
    if (!detected) return;

    suppressOnce = true;
    ensureRoot();

    const r = (e.target as Element | null)?.getBoundingClientRect?.();
    const anchor = r
      ? {
          pageX: r.left + window.scrollX + r.width / 2,
          pageY: r.top + window.scrollY,
          pageBottom: r.bottom + window.scrollY,
        }
      : {
          pageX: e.pageX,
          pageY: e.pageY,
          pageBottom: e.pageY + 16,
        };

    showUrlPopover({ url: detected.url, anchor });
  }, true);

  return {
    shouldSuppressToolbar: () => {
      if (!suppressOnce) return false;
      suppressOnce = false;
      return true;
    },
  };
}

export { hideUrlPopover, isUrlPopoverOpen };
