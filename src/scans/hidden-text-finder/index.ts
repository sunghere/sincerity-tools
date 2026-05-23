/**
 * Public entry. Runs the scan and hands the result off to the overlay.
 * Wrapped so callers (content-script message handler, future Tool integration)
 * have one function to invoke.
 */
import { scanHiddenText } from "./scanner";
import { showOverlay, hideOverlay } from "./overlay";

export function runHiddenTextScan(): void {
  const { findings, truncated } = scanHiddenText(document);
  showOverlay({ findings, truncated });
}

export { hideOverlay };

export const SCAN_ID = "hidden-text-finder";
