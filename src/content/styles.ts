/**
 * Injected into the shadow root. Kept as a string (not a separate .css file)
 * so the entire content-script bundle is one ESM file with no asset fetches.
 *
 * Design notes:
 * - Dark, Slack-inspired toolbar with rounded buttons and hover tint.
 * - Popover uses the same surface as the toolbar so they feel related.
 * - z-index uses the int32 max so we sit above every reasonable host overlay.
 */
export const STYLES = `
  :host {
    all: initial;
  }
  * {
    box-sizing: border-box;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
      'Helvetica Neue', Arial, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
  }

  .toolbar,
  .popover {
    position: absolute;
    z-index: 2147483647;
    color: #e8e8ec;
    background: #1d1d20;
    border: 1px solid #2c2c33;
    border-radius: 10px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
    /* Don't inherit the page's text selection styling. */
    user-select: none;
  }

  /* ---------- toolbar (Slack-style hover bar) ---------- */
  .toolbar {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
  }
  .toolbar-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: #d4d4d8;
    cursor: pointer;
    transition: background 80ms ease, color 80ms ease;
  }
  .toolbar-btn:hover {
    background: #2c2c33;
    color: #ffffff;
  }
  .toolbar-btn:focus-visible {
    outline: 2px solid #4d9fff;
    outline-offset: 1px;
  }
  /* Dimmed = tool's canHandle() returned false for the current selection.
     The button stays clickable so the user can override the heuristic. */
  .toolbar-btn.dimmed {
    opacity: 0.38;
  }
  .toolbar-btn.dimmed:hover {
    opacity: 1;
  }
  .toolbar-btn svg {
    width: 16px;
    height: 16px;
    pointer-events: none;
  }
  .tooltip {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    padding: 4px 8px;
    background: #0d0d10;
    color: #ffffff;
    font-size: 11px;
    line-height: 1;
    white-space: nowrap;
    border-radius: 4px;
    pointer-events: none;
    opacity: 0;
    transition: opacity 80ms ease;
  }
  .toolbar-btn:hover .tooltip,
  .toolbar-btn:focus-visible .tooltip {
    opacity: 1;
  }

  /* ---------- popover (result panel) ---------- */
  .popover {
    min-width: 240px;
    max-width: 480px;
    overflow: hidden;
  }
  .popover-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 12px;
    background: #25252b;
    border-bottom: 1px solid #2c2c33;
    font-size: 12px;
    font-weight: 600;
    color: #f1f1f5;
  }
  .popover-hint {
    font-size: 10px;
    font-weight: 500;
    color: #8a8a93;
    border: 1px solid #3a3a42;
    border-radius: 3px;
    padding: 1px 5px;
    letter-spacing: 0.5px;
  }
  .popover-body {
    padding: 10px 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono',
      monospace;
    font-size: 12.5px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 320px;
    overflow: auto;
    color: #e8e8ec;
  }
  .popover.error .popover-header {
    background: #3a1f1f;
    color: #ff9c9c;
  }
  .popover.error .popover-body {
    color: #ffb4b4;
    white-space: pre-wrap;
    word-break: normal;
  }
  .popover-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    padding: 6px 10px;
    background: #1a1a1d;
    border-top: 1px solid #2c2c33;
  }
  .footer-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: transparent;
    color: #ccc;
    border: 1px solid #3a3a42;
    border-radius: 4px;
    padding: 3px 9px;
    font-size: 11px;
    line-height: 1;
    cursor: pointer;
    transition: background 80ms ease, color 80ms ease, border-color 80ms ease;
  }
  .footer-btn:hover {
    background: #2c2c33;
    color: #ffffff;
  }
  .footer-btn.primary {
    background: #4d9fff;
    border-color: #4d9fff;
    color: #061224;
    font-weight: 600;
  }
  .footer-btn.primary:hover {
    background: #6db0ff;
    border-color: #6db0ff;
    color: #061224;
  }
  .footer-btn-icon {
    display: inline-flex;
    align-items: center;
  }
  .footer-btn-icon svg {
    width: 13px;
    height: 13px;
    display: block;
  }
  /* --- URL QR tool --- */
  .qr-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 4px 0 2px;
  }
  .qr-frame {
    background: #0d0d10;
    padding: 8px;
    border-radius: 6px;
    border: 1px solid #2c2c33;
    line-height: 0;
  }
  .qr-frame svg {
    display: block;
    width: 200px;
    height: 200px;
  }
  .qr-caption {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
      'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
    font-size: 11px;
    color: #8a8a93;
  }

  /* --- URL Inspector --- */
  .url-inspect {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
      'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
    font-size: 12.5px;
  }
  .url-warn {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: -2px 0 8px;
    padding: 8px 10px;
    background: rgba(240, 200, 96, 0.08);
    border: 1px solid rgba(240, 200, 96, 0.3);
    border-radius: 5px;
    color: #f0c860;
    font-size: 11.5px;
    line-height: 1.45;
  }
  .url-warn-row + .url-warn-row { margin-top: 2px; }
  .url-row {
    display: flex;
    gap: 8px;
    line-height: 1.5;
  }
  .url-label {
    flex: 0 0 60px;
    color: #8a8a93;
    font-size: 11.5px;
  }
  .url-val {
    flex: 1;
    color: #e8e8ec;
    word-break: break-all;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
  }
  .url-section-label {
    color: #8a8a93;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 6px 0 2px;
  }
  .url-params {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding-left: 8px;
    border-left: 2px solid #2c2c33;
  }
  .url-param {
    display: flex;
    gap: 8px;
    font-size: 12px;
  }
  .url-param-key {
    flex: 0 0 100px;
    color: #b9d6ff;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    word-break: break-all;
  }
  .url-param-val {
    flex: 1;
    color: #e8e8ec;
    word-break: break-all;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

  .footer-btn.copy-btn.copied {
    color: #7ad17a;
    border-color: #7ad17a;
  }
`;
