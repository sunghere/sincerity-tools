/**
 * Virtual module injected by the buildInfoPlugin() in vite.config.ts.
 *
 * `version`  — package.json version, matches `chrome.runtime.getManifest().version`.
 * `buildId`  — short identifier that changes on every build: `<gitSha>[-dev].<epoch36>`.
 *              The "-dev" suffix is appended when the working tree is dirty.
 * `buildTime`— ISO timestamp at the moment Vite loaded this virtual module.
 * `gitSha`   — short git SHA of HEAD ("nogit" if git isn't available).
 * `dirty`    — true if `git status --porcelain` reported uncommitted changes.
 */
declare module "virtual:sincerity-build-info" {
  export const BUILD_INFO: Readonly<{
    version: string;
    buildId: string;
    buildTime: string;
    gitSha: string;
    dirty: boolean;
  }>;
}
