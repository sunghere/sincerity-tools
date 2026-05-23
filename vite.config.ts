import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config";

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(here, "package.json");

/**
 * Exposes `virtual:sincerity-build-info` to the source tree. The popup reads
 * it to render the visible "build" badge so the developer can confirm that a
 * code change actually made it into the loaded extension — without bumping
 * the release version on every edit.
 *
 * - In `vite build` (production): load() runs once during bundling, so each
 *   `npm run build` bakes a fresh buildId into the bundle.
 * - In `vite` (dev with @crxjs HMR): handleHotUpdate() invalidates the cached
 *   virtual module on every source edit, so the next HMR cycle re-runs load()
 *   and the popup picks up a fresh buildId.
 */
function buildInfoPlugin(): Plugin {
  const VIRTUAL_ID = "virtual:sincerity-build-info";
  const RESOLVED_ID = "\0" + VIRTUAL_ID;
  let server: ViteDevServer | null = null;

  const git = (args: string): string => {
    try {
      return execSync(`git ${args}`, { stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
    } catch {
      return "";
    }
  };

  const readVersion = (): string => {
    try {
      return (JSON.parse(readFileSync(pkgPath, "utf8")).version as string) || "0.0.0";
    } catch {
      return "0.0.0";
    }
  };

  const collect = () => {
    const version = readVersion();
    const sha = git("rev-parse --short HEAD") || "nogit";
    const dirty = git("status --porcelain").length > 0;
    const buildTime = new Date().toISOString();
    // Short, monotonic tag the developer can eyeball: <sha>[-dev].<base36 epoch>
    const epochTag = Math.floor(Date.now() / 1000).toString(36);
    const buildId = `${sha}${dirty ? "-dev" : ""}.${epochTag}`;
    return { version, gitSha: sha, dirty, buildTime, buildId };
  };

  return {
    name: "sincerity:build-info",
    configureServer(s) {
      server = s;
    },
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
      return null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      const info = collect();
      return `export const BUILD_INFO = Object.freeze(${JSON.stringify(info)});\n`;
    },
    handleHotUpdate() {
      // Any source edit during dev should produce a fresh buildId in the popup.
      if (!server) return;
      const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
      if (mod) server.moduleGraph.invalidateModule(mod);
    },
  };
}

export default defineConfig({
  plugins: [buildInfoPlugin(), crx({ manifest })],
  build: {
    target: "esnext",
    sourcemap: true,
    rollupOptions: {
      output: {
        // Keep predictable file names so manifest updates are stable across builds.
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
