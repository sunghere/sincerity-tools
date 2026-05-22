#!/usr/bin/env node
/**
 * One-shot GitHub bootstrap for sincerity-tools.
 *
 *   1. cleans sandbox leftovers (.git-broken*, .dist*-stale, etc.)
 *   2. verifies gh + git available, gh authenticated
 *   3. git init + first commit if needed
 *   4. picks up any uncommitted changes (auto-stage + commit "chore: sync")
 *   5. gh repo create + push (idempotent: re-running pushes any new commits)
 *
 * Usage:
 *   node scripts/github-init.mjs
 *   node scripts/github-init.mjs my-org/repo
 *   node scripts/github-init.mjs --private
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
process.chdir(root);

const args = process.argv.slice(2);
const privateFlag = args.includes("--private");
const repoArg = args.find((a) => !a.startsWith("--"));

// --- 0. clean sandbox leftovers ---
const stalePrefixes = [".git-broken", ".dist-stale", ".dist2-stale", ".vite.config.ts.timestamp-"];
for (const entry of readdirSync(root)) {
  if (stalePrefixes.some((p) => entry.startsWith(p))) {
    try {
      rmSync(join(root, entry), { recursive: true, force: true });
      console.log(`cleaned stale: ${entry}`);
    } catch (e) {
      console.warn(`could not remove ${entry}: ${e.message}`);
    }
  }
}

// --- 1. preflight ---
ensure(["git", "--version"], "git is required.");
ensure(["gh", "--version"], "gh CLI is required. Install: https://cli.github.com/");
ensure(["gh", "auth", "status"], "gh is not authenticated. Run: gh auth login");

// --- 2. resolve owner/name ---
let owner, name;
if (repoArg) {
  if (repoArg.includes("/")) [owner, name] = repoArg.split("/");
  else name = repoArg;
}
if (!owner) owner = capture("gh api user --jq .login").trim();
if (!name) {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));
  name = pkg.name;
}
const slug = `${owner}/${name}`;
console.log(`target repo: ${slug} (${privateFlag ? "private" : "public"})`);

// --- 3. git init if missing ---
if (existsSync(resolve(root, ".git")) && !isHealthyGitDir(resolve(root, ".git"))) {
  const aside = resolve(root, `.git-broken-${Date.now()}`);
  console.log(`existing .git looks broken; moving aside to ${aside}`);
  const moveCmd = process.platform === "win32" ? `move .git "${aside}"` : `mv .git "${aside}"`;
  execSync(moveCmd, { stdio: "inherit" });
}
if (!existsSync(resolve(root, ".git"))) {
  run("git init -b main");
}

// --- 4. commit any pending changes ---
// (a) first commit if there's no HEAD yet
const hasCommit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, stdio: "ignore" }).status === 0;
if (!hasCommit) {
  run("git add -A");
  run('git commit -m "chore: initial commit"');
} else {
  // (b) follow-up commits — pick up anything that's untracked or modified.
  // This is the case we missed before: a repo with 1 stale commit but the
  // actual source files were never staged. `git status --porcelain` returns
  // a non-empty string if there's anything to commit.
  const dirty = execSync("git status --porcelain", { cwd: root, encoding: "utf-8" }).trim();
  if (dirty) {
    console.log("uncommitted changes detected; staging and committing them:");
    console.log(dirty.split("\n").map((l) => "  " + l).join("\n"));
    run("git add -A");
    run('git commit -m "chore: sync working tree"');
  }
}

// --- 5. ensure remote + push ---
const repoExists = spawnSync("gh", ["repo", "view", slug], { stdio: "ignore" }).status === 0;
if (!repoExists) {
  const visibility = privateFlag ? "--private" : "--public";
  run(`gh repo create ${slug} ${visibility} --source=. --remote=origin --push`);
  console.log(`created and pushed: https://github.com/${slug}`);
} else {
  console.log("repo already exists on GitHub.");
  let remoteUrl = "";
  try { remoteUrl = capture("git remote get-url origin").trim(); } catch {}
  if (!remoteUrl) run(`git remote add origin https://github.com/${slug}.git`);
  run("git push -u origin main --follow-tags");
}

console.log(`\nDone. Repo: https://github.com/${slug}`);
console.log(`Pages: enable at https://github.com/${slug}/settings/pages  (Source: main, Folder: /docs)`);

// ------------------- helpers -------------------

function run(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

function capture(cmd) {
  return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString();
}

function ensure(parts, message) {
  const [bin, ...rest] = parts;
  const ok = spawnSync(bin, rest, { stdio: "ignore" }).status === 0;
  if (!ok) {
    console.error(`error: ${message}`);
    process.exit(1);
  }
}

function isHealthyGitDir(gitDir) {
  try {
    if (!statSync(join(gitDir, "objects")).isDirectory()) return false;
    if (!statSync(join(gitDir, "refs")).isDirectory()) return false;
    if (!statSync(join(gitDir, "HEAD")).isFile()) return false;
    if (existsSync(join(gitDir, "config"))) {
      const c = readFileSync(join(gitDir, "config"), "utf-8");
      if (c.length === 0 || !c.includes("[")) return false;
    }
    return true;
  } catch {
    return false;
  }
}
