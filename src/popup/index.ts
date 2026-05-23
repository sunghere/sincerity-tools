/**
 * Popup entry. Renders product blurb + the currently-installed build's metadata.
 *
 * `BUILD_INFO` comes from the `virtual:sincerity-build-info` module defined by
 * buildInfoPlugin() in vite.config.ts. The release version stays in
 * package.json (and the manifest); the buildId is the part that changes on
 * every rebuild — that's how we tell at a glance whether a code edit really
 * made it into the loaded extension.
 */
import { BUILD_INFO } from "virtual:sincerity-build-info";

function set(id: string, fill: (el: HTMLElement) => void): void {
  const el = document.getElementById(id);
  if (el) fill(el);
}

set("version", (el) => {
  el.textContent = `v${BUILD_INFO.version}`;
});

set("build", (el) => {
  el.textContent = BUILD_INFO.buildId;
  if (BUILD_INFO.dirty) el.classList.add("dirty");
  el.title = BUILD_INFO.dirty
    ? `git ${BUILD_INFO.gitSha} (uncommitted changes)`
    : `git ${BUILD_INFO.gitSha}`;
});

set("time", (el) => {
  try {
    el.textContent = new Date(BUILD_INFO.buildTime).toLocaleString();
  } catch {
    el.textContent = BUILD_INFO.buildTime;
  }
});

set("copy", (el) => {
  const year = new Date().getFullYear();
  el.textContent = `© ${year} Sincerity Tools · MIT`;
});
