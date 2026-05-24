#!/usr/bin/env node
/**
 * Installs git hooks under `.git/hooks/` from the templates in `scripts/hooks/`.
 *
 * Run automatically by `npm install` via the `prepare` lifecycle script. Safe
 * to re-run; an existing file at the destination is overwritten only when its
 * content was previously installed by this script (header sentinel check) —
 * any user-customized hook is left alone.
 *
 * No-ops in CI (`CI=true`) and when not inside a git working copy (e.g. an
 * `npm install` from a packed tarball).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, chmodSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const hooksSrcDir = resolve(here, "hooks");
const gitDir = resolve(repoRoot, ".git");
const hooksDstDir = resolve(gitDir, "hooks");

const SENTINEL = "# sincerity-tools:managed-hook";

if (process.env.CI === "true") {
  // Don't litter the CI runner's git config; CI does its own builds.
  process.exit(0);
}

if (!existsSync(gitDir) || !statSync(gitDir).isDirectory()) {
  // Not a git checkout (e.g. an `npm install` over a tarball). Quietly skip.
  process.exit(0);
}

if (!existsSync(hooksSrcDir)) {
  // No templates to install. Quietly skip.
  process.exit(0);
}

mkdirSync(hooksDstDir, { recursive: true });

let installed = 0;
let skipped = 0;
for (const name of readdirSync(hooksSrcDir)) {
  const src = resolve(hooksSrcDir, name);
  const dst = resolve(hooksDstDir, name);
  const incoming = readFileSync(src, "utf8");

  if (existsSync(dst)) {
    const existing = readFileSync(dst, "utf8");
    if (!existing.includes(SENTINEL)) {
      // User has a custom hook here — don't overwrite.
      console.warn(`[setup-git-hooks] ${name}: existing custom hook, skipping.`);
      skipped++;
      continue;
    }
    if (existing === incoming) {
      // Already up to date.
      continue;
    }
  }

  writeFileSync(dst, incoming, "utf8");
  // Make executable on POSIX. chmod is a no-op on Windows but harmless.
  try {
    chmodSync(dst, 0o755);
  } catch {
    /* ignore */
  }
  installed++;
}

if (installed > 0) {
  console.log(`[setup-git-hooks] installed ${installed} hook(s); ${skipped} preserved.`);
}
