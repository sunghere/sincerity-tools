/**
 * Tool contract — everything the toolbar/popover layer needs to know about a tool.
 *
 * Adding a new tool = create a folder under `src/tools/<name>/`, export a Tool,
 * and register it in `src/tools/registry.ts`. The toolbar will auto-render the
 * icon for any selection where `canHandle` returns true.
 */
export interface Tool {
  /** Stable id, used as a DOM data attribute and key. */
  id: string;
  /** Human-readable name, shown in tooltip and popover title. */
  name: string;
  /**
   * Inline SVG markup for the toolbar button. 16x16 viewBox preferred so it
   * matches the icon slot without extra CSS sizing rules.
   */
  iconSvg: string;
  /**
   * Right-click context-menu contexts where this tool should appear. Defaults
   * to `["selection"]` — the user selected text and right-clicked. Tools that
   * also make sense on a link (e.g. URL 분석) should add `"link"`, in which
   * case the background passes `info.linkUrl` as the tool input.
   *
   * Chrome's full set: "selection", "link", "page", "image", "video", "audio",
   * "editable", "frame". Most don't apply here; keep usage narrow.
   */
  contexts?: chrome.contextMenus.ContextType[];
  /** Quick filter: should this tool offer itself for this selection? */
  canHandle(selection: string): boolean;
  /**
   * Run the tool against the selection. Either return the result synchronously
   * or asynchronously — the popover renders a loading state while pending.
   *
   * The returned `body` is rendered as text (not HTML) to avoid XSS on
   * untrusted selections. Use `bodyHtml` only when the tool produces
   * trusted, sanitized markup.
   *
   * `ctx` carries information the framework already computed and that a
   * tool would otherwise have to rediscover — currently just the anchor
   * rect for tools that want to render a custom popover (set
   * `result.skipPopover` to true to suppress the generic one).
   */
  run(selection: string, ctx: ToolRunContext): ToolResult | Promise<ToolResult>;
}

export interface ToolRunContext {
  /** Page-coordinate anchor for any custom UI the tool spawns. */
  anchor: ToolAnchor;
}

export interface ToolAnchor {
  pageX: number;
  pageY: number;
  pageBottom: number;
}

export interface ToolResult {
  title?: string;
  /** Plain-text result; rendered with `textContent` (XSS-safe). */
  body: string;
  /**
   * Optional pre-rendered, trusted HTML. Used for error states with formatting.
   * Tools should set EITHER body OR bodyHtml, not both.
   */
  bodyHtml?: string;
  /** Style the popover differently for errors. */
  status?: "ok" | "error";
  /**
   * Extra footer actions, rendered as buttons next to the copy button.
   * Use for context-aware affordances — e.g. an "Open" button when the
   * decoded result is a URL.
   */
  actions?: ToolAction[];
  /**
   * When true, the framework will NOT render the generic popover for this
   * result. Tools that render their own custom UI (e.g. URL inspector with
   * its async safety-check rows) set this and call their own popover from
   * inside `run()`.
   */
  skipPopover?: boolean;
}

/**
 * A footer button rendered in the popover.
 *
 * Keep `onClick` lightweight: it runs in the content-script context, so it can
 * call `window.open`, write to `navigator.clipboard`, dispatch DOM events,
 * etc., but it shouldn't await long-running work without giving feedback.
 */
export interface ToolAction {
  /** Visible button text. */
  label: string;
  /** Optional inline SVG markup; rendered to the left of the label. */
  iconSvg?: string;
  /** Visual treatment. Defaults to "default" (subtle). */
  variant?: "default" | "primary";
  /** Click handler. */
  onClick: () => void;
}
