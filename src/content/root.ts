import { STYLES } from "./styles";

/**
 * Single shadow-DOM host shared by the toolbar and popover.
 *
 * Why a shadow root?
 *   - Style isolation: arbitrary host pages won't bleed CSS into our UI and vice versa.
 *
 * Why `position: absolute; top: 0; left: 0` on the host?
 *   - Children inside the shadow root use `position: absolute` with page coordinates
 *     (rect + window.scrollY). When the page scrolls, an absolute-positioned element
 *     with no positioned ancestor uses the initial containing block, which scrolls
 *     with the document. Pinning the host at the document origin makes the math
 *     unambiguous: `top: ${pageY}px` means "pageY pixels from the top of the document".
 */
const HOST_ID = "__sincerity_tools_host__";

let shadow: ShadowRoot | null = null;
let host: HTMLDivElement | null = null;

export function ensureRoot(): ShadowRoot {
  if (shadow) return shadow;

  host = document.getElementById(HOST_ID) as HTMLDivElement | null;
  if (!host) {
    host = document.createElement("div");
    host.id = HOST_ID;
    // Take the host out of normal flow — width/height 0 means we never affect layout.
    host.style.cssText =
      "all: initial; position: absolute; top: 0; left: 0; width: 0; height: 0; pointer-events: none;";
    // Use documentElement (not body) — some pages render the toolbar above
    // overlays only if we attach to <html>.
    document.documentElement.appendChild(host);
  }

  shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  if (!shadow.querySelector("style[data-sincerity-tools]")) {
    const styleEl = document.createElement("style");
    styleEl.setAttribute("data-sincerity-tools", "");
    styleEl.textContent = STYLES;
    shadow.appendChild(styleEl);
  }
  return shadow;
}

/**
 * Tells whether a Node belongs to our UI.
 * Used to ignore mouseup/mousedown events that originate inside the toolbar/popover.
 */
export function isInsideOurUI(target: EventTarget | null): boolean {
  if (!(target instanceof Node)) return false;
  if (host && host.contains(target)) return true;
  // Shadow DOM: events bubble up with composedPath, but the target attribute
  // is retargeted to the host element. Belt-and-suspenders check on the root.
  const root = target.getRootNode();
  return root instanceof ShadowRoot && root === host?.shadowRoot;
}
