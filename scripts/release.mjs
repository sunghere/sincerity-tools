#!/usr/bin/env node
/**
 * One-shot release: version bump -> build -> zip -> commit -> tag
 *                  -> (optional) git push --follow-tags + gh release create.
 *
 * Usage:
 *   node scripts/release.mjs patch                # 0.1.0 -> 0.1.1
 *   node scripts/release.mjs minor                # 0.1.0 -> 0.2.0
 *   node scripts/release.mjs major                # 0.1.0 -> 1.0.0
 *   node scripts/release.mjs 1.2.3                # explicit version
 *
 * Flags:
 *   --no-tag       Skip creating a git tag.
 *   --no-zip       Skip building the release zip.
 *   --no-commit    Don't create the version-bump commit.
 *   --no-push      Don't push or publish a GitHub Release (default: push + publish).
 *   --draft        gh release create --draft (mark the GitHub Release as draft).
 *   --notes "..."  Override release body (default: auto-generated from commit log).
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, createWriteStream } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import archiver from "archiver";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const args = process.argv.slice(2);
const bumpArg = args.find((a) => !a.startsWith("--"));
const flags = new Set(args.filter((a) => a.startsWith("--") && !a.startsWith("--notes")));
const notesIdx = args.indexOf("--notes");
const notesOverride = notesIdx >= 0 ? args[notesIdx + 1] : null;

if (!bumpArg) {
  console.error("Usage: node scripts/release.mjs <patch|minor|major|X.Y.Z> [flags]");
  process.exit(1);
}

function run(cmd) { console.log(`$ ${cmd}`); return execSync(cmd, { cwd: root, stdio: "inherit" }); }
function readJson(file) { return JSON.parse(readFileSync(file, "utf-8")); }
function writeJson(file, obj) { writeFileSync(file, JSON.stringify(obj, null, 2) + "\n", "utf-8"); }
function capture(cmd) { return execSync(cmd, { cwd: root, encoding: "utf-8" }).trim(); }
function has(bin) { return spawnSync(bin, ["--version"], { stdio: "ignore" }).status === 0; }

// --- 1. clean working tree check (skip if both git steps disabled) ---
const skipGit = flags.has("--no-commit") && flags.has("--no-tag");
if (!skipGit) {
  try {
    const status = capture("git status --porcelain");
    if (status && !flags.has("--no-commit")) {
      console.error("Working tree is not clean. Commit or stash changes first, or pass --no-commit.");
      console.error(status);
      process.exit(1);
    }
  } catch {
    console.error("Not a git repo. Re-run with --no-commit --no-tag --no-push.");
    process.exit(1);
  }
}

// --- 2. bump version ---
const pkgPath = resolve(root, "package.json");
const pkg = readJson(pkgPath);
const oldVersion = pkg.version;
const newVersion = bumpVersion(oldVersion, bumpArg);
pkg.version = newVersion;
writeJson(pkgPath, pkg);
console.log(`version: ${oldVersion} -> ${newVersion}`);

// --- 3. build ---
run("npm run build");

// --- 4. zip dist/ ---
let zipPath = null;
if (!flags.has("--no-zip")) {
  const releasesDir = resolve(root, "releases");
  if (!existsSync(releasesDir)) mkdirSync(releasesDir, { recursive: true });
  zipPath = resolve(releasesDir, `sincerity-tools-v${newVersion}.zip`);
  if (existsSync(zipPath)) rmSync(zipPath);
  await zipDirectory(resolve(root, "dist"), zipPath);
  console.log(`packaged: ${zipPath}`);
}

// --- 5. commit + tag ---
if (!flags.has("--no-commit")) {
  run("git add package.json");
  run(`git commit -m "release: v${newVersion}"`);
}
if (!flags.has("--no-tag")) {
  run(`git tag -a v${newVersion} -m "v${newVersion}"`);
  console.log(`tagged: v${newVersion}`);
}

// --- 6. push + GitHub Release ---
if (!flags.has("--no-push")) {
  run("git push --follow-tags");

  if (has("gh") && spawnSync("gh", ["auth", "status"], { stdio: "ignore" }).status === 0) {
    // Auto-generate notes from commits since the previous tag, unless overridden.
    let notes = notesOverride;
    if (!notes) {
      try {
        const prevTag = capture(`git describe --tags --abbrev=0 v${newVersion}^`);
        const log = capture(`git log ${prevTag}..v${newVersion} --pretty=format:"- %s"`);
        notes = log || `Release v${newVersion}.`;
      } catch {
        notes = `Release v${newVersion}.`;
      }
    }
    const draft = flags.has("--draft") ? "--draft" : "";
    const assets = zipPath ? `"${zipPath}"` : "";
    // Write notes to a temp file to avoid shell-escape pain.
    const notesFile = resolve(root, ".release-notes.tmp");
    writeFileSync(notesFile, notes, "utf-8");
    try {
      run(`gh release create v${newVersion} ${assets} --title "v${newVersion}" --notes-file "${notesFile}" ${draft}`.trim());
    } finally {
      try { rmSync(notesFile); } catch {}
    }
    console.log(`released: https://github.com/$(gh repo view --json nameWithOwner --jq .nameWithOwner)/releases/tag/v${newVersion}`);
  } else {
    console.log("gh not authenticated — skipping GitHub Release. Create it manually:");
    if (zipPath) {
      console.log(`  gh release create v${newVersion} "${zipPath}" --title "v${newVersion}" --generate-notes`);
    } else {
      console.log(`  gh release create v${newVersion} --title "v${newVersion}" --generate-notes`);
    }
  }
}

console.log(`\nDone. v${newVersion}`);

function bumpVersion(current, kind) {
  const semverRe = /^(\d+)\.(\d+)\.(\d+)$/;
  if (semverRe.test(kind)) return kind;
  const m = current.match(semverRe);
  if (!m) throw new Error(`Cannot parse current version: ${current}`);
  let [, maj, min, pat] = m.map(Number);
  if (kind === "patch") pat++;
  else if (kind === "minor") { min++; pat = 0; }
  else if (kind === "major") { maj++; min = 0; pat = 0; }
  else throw new Error(`Unknown bump: ${kind}`);
  return `${maj}.${min}.${pat}`;
}

function zipDirectory(srcDir, destZip) {
  return new Promise((resolvePromise, rejectPromise) => {
    const output = createWriteStream(destZip);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", () => resolvePromise());
    archive.on("error", rejectPromise);
    archive.pipe(output);
    archive.directory(srcDir, false);
    archive.finalize();
  });
}
