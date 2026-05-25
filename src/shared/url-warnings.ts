/**
 * URL safety heuristics shared between:
 *   - `tools/url-inspector` (selection-driven, runs from the toolbar)
 *   - `content/url-actions/popover` (dblclick-driven)
 *
 * Pure function — no DOM, no chrome.*, no imports. Both bundles tree-shake
 * it correctly and ship a single copy through the registry.
 */
export function collectUrlWarnings(u: URL): string[] {
  const w: string[] = [];
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname)) {
    w.push("⚠ 도메인 대신 IP 주소를 사용합니다 — 일반적인 사이트는 아닙니다.");
  }
  if (/(^|\.)xn--/i.test(u.hostname)) {
    w.push("⚠ punycode가 포함된 도메인입니다 — 다른 사이트로 오해할 수 있어요.");
  }
  if (u.username || u.password) {
    w.push("⚠ URL에 사용자 정보가 들어있습니다.");
  }
  if (u.protocol === "http:") {
    w.push("⚠ 암호화되지 않은 http입니다 — 입력한 정보가 노출될 수 있습니다.");
  }
  const labels = u.hostname.split(".");
  if (labels.length >= 5) {
    w.push("ℹ 서브도메인이 매우 깊습니다 — 한 번 더 확인해 보세요.");
  }
  return w;
}
