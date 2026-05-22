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
  /** Quick filter: should this tool offer itself for this selection? */
  canHandle(selection: string): boolean;
  /**
   * Run the tool against the selection. Either return the result synchronously
   * or asynchronously — the popover renders a loading state while pending.
   *
   * The returned `body` is rendered as text (not HTML) to avoid XSS on
   * untrusted selections. Use `bodyHtml` only when the tool produces
   * trusted, sanitized markup.
   */
  run(selection: string): ToolResult | Promise<ToolResult>;
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
