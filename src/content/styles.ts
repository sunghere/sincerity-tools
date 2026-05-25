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
  .popover-dismiss {
    display: inline-flex;
    align-items: center;
    gap: 6px;
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
  .popover-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: 4px;
    color: #8a8a93;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    transition: background 80ms ease, color 80ms ease;
  }
  .popover-close:hover {
    background: #2c2c33;
    color: #ffffff;
  }
  .popover-close:focus-visible {
    outline: 2px solid #4d9fff;
    outline-offset: 1px;
  }
  /* Match the error tint when the popover is in error state. */
  .popover.error .popover-close {
    color: #ff9c9c;
  }
  .popover.error .popover-close:hover {
    background: rgba(255, 156, 156, 0.12);
    color: #ffd4d4;
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

  /* ---------- URL-on-dblclick popover ---------- */
  .url-pop {
    position: absolute;
    z-index: 2147483647;
    width: 320px;
    color: #e8e8ec;
    background: #1d1d20;
    border: 1px solid #2c2c33;
    border-radius: 10px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
    user-select: none;
    overflow: hidden;
  }
  .url-pop-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px 8px;
    background: #25252b;
    border-bottom: 1px solid #2c2c33;
  }
  .url-pop-title {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    flex: 1;
  }
  .url-pop-title strong {
    font-size: 13px;
    font-weight: 600;
    color: #f1f1f5;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .url-pop-path {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    color: #8a8a93;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .url-pop-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: 4px;
    color: #8a8a93;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
    flex-shrink: 0;
  }
  .url-pop-close:hover { background: #2c2c33; color: #fff; }

  .url-pop-actions {
    display: flex;
    gap: 6px;
    padding: 10px 12px;
    border-bottom: 1px solid #2c2c33;
  }
  .url-pop-btn {
    flex: 1;
    background: transparent;
    border: 1px solid #3a3a42;
    color: #d4d4d8;
    border-radius: 5px;
    padding: 5px 8px;
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
    transition: background 80ms ease, border-color 80ms ease, color 80ms ease;
  }
  .url-pop-btn:hover { background: #2c2c33; color: #fff; }
  .url-pop-btn.primary {
    background: #4d9fff;
    border-color: #4d9fff;
    color: #061224;
    font-weight: 600;
  }
  .url-pop-btn.primary:hover { background: #6db0ff; border-color: #6db0ff; color: #061224; }
  .url-pop-btn.done { color: #7ad17a; border-color: #7ad17a; }
  .url-pop-btn.err { color: #ff9c9c; border-color: #ff9c9c; }
  .url-pop-btn:disabled { opacity: 0.6; cursor: default; }

  .url-pop-warn {
    padding: 8px 12px;
    background: rgba(240, 200, 96, 0.08);
    border-bottom: 1px solid rgba(240, 200, 96, 0.18);
    color: #f0c860;
    font-size: 11.5px;
    line-height: 1.45;
  }
  .url-pop-warn-row + .url-pop-warn-row { margin-top: 3px; }

  .url-pop-safety-wrap {
    display: flex;
    flex-direction: column;
  }
  .url-pop-safety {
    padding: 8px 12px;
    border-bottom: 1px solid #2c2c33;
    font-size: 11.5px;
    line-height: 1.4;
  }
  .url-pop-safety + .url-pop-safety {
    border-top: 0;
  }
  .url-pop-safety-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .url-pop-safety-provider {
    font-size: 10.5px;
    font-weight: 600;
    color: #8a8a93;
    padding: 1px 6px;
    border: 1px solid #3a3a42;
    border-radius: 3px;
    letter-spacing: 0.3px;
  }
  .url-pop-safety-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    font-size: 11px;
    font-weight: 700;
    background: #2c2c33;
    color: #d4d4d8;
    flex-shrink: 0;
  }
  .url-pop-safety-label { font-weight: 500; }
  .url-pop-safety-detail {
    margin-top: 4px;
    margin-left: 26px;
    color: #8a8a93;
    font-size: 10.5px;
  }
  .url-pop-safety.pending .url-pop-safety-icon { background: #2c2c33; }
  .url-pop-safety.pending .url-pop-safety-label { color: #b9b9c2; }
  .url-pop-safety.safe .url-pop-safety-icon { background: #1f3320; color: #7ad17a; }
  .url-pop-safety.safe .url-pop-safety-label { color: #7ad17a; }
  .url-pop-safety.danger .url-pop-safety-icon { background: #3f1d1d; color: #ff9c9c; }
  .url-pop-safety.danger .url-pop-safety-label { color: #ff9c9c; }
  .url-pop-safety.unknown .url-pop-safety-icon { background: #3f3214; color: #facc15; }
  .url-pop-safety.unknown .url-pop-safety-label { color: #facc15; }
  /* "error" state is for transport/parse failures — visually distinct from
     "unknown" (which is the *provider's* verdict). Muted gray-blue so users
     don't read it as "the URL is dangerous". */
  .url-pop-safety.error .url-pop-safety-icon { background: #2c2c38; color: #9aa3b2; }
  .url-pop-safety.error .url-pop-safety-label { color: #b9b9c2; }
  .url-pop-safety.error .url-pop-safety-detail { color: #8a8a93; }

  .url-pop-spinner {
    display: inline-block;
    width: 11px;
    height: 11px;
    border: 1.5px solid #4a4a52;
    border-top-color: #d4d4d8;
    border-radius: 50%;
    animation: url-pop-spin 700ms linear infinite;
  }
  @keyframes url-pop-spin {
    to { transform: rotate(360deg); }
  }

  .url-pop-details {
    padding: 8px 12px 10px;
    border-bottom: 1px solid #2c2c33;
    font-size: 11px;
    max-height: 200px;
    overflow: auto;
  }
  .url-pop-details .url-inspect { gap: 2px; }
  .url-pop-details .url-row { line-height: 1.45; }
  .url-pop-details .url-label { flex: 0 0 48px; }

  .url-pop-attrib {
    padding: 6px 12px;
    background: #1a1a1d;
    font-size: 10px;
    color: #6b6b73;
    text-align: right;
  }
`;
