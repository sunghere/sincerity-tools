#!/usr/bin/env node
/**
 * Bootstrap the GitHub repo for sincerity-tools.
 *
 * Run once after cloning / starting the project, from a shell where gh CLI
 * is installed and authenticated (`gh auth status` should print OK).
 *
 * Usage:
 *   node scripts/github-init.mjs                # uses your gh user, repo "sincerity-tools"
 *   node scripts/github-init.mjs my-org/repo    # explicit owner/name
 *   node scripts/github-init.mjs --private      # create as private
 *
 * Idempotent: re-running after the repo exists just ensures the remote is
 * wired up and pushes any local commits.
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
process.chdir(root);

const args = process.argv.slice(2);
const privateFlag = args.includes("--private");
const repoArg = args.find((a) => !a.startsWith("--"));

// --- 1. preflight ---
ensure(["git", "--version"], "git is required.");
ensure(["gh", "--version"], "gh CLI is required. Install from https://cli.github.com/");
ensure(["gh", "auth", "status"], "gh is not authenticated. Run: gh auth login");

// --- 2. resolve owner/name ---
let owner, name;
if (repoArg) {
  if (repoArg.includes("/")) {
    [owner, name] = repoArg.split("/");
  } else {
    name = repoArg;
  }
}
if (!owner) owner = capture("gh api user --jq .login").trim();
if (!name) {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));
  name = pkg.name;
}
const slug = `${owner}/${name}`;
console.log(`target repo: ${slug} (${privateFlag ? "private" : "public"})`);

// --- 3. git init + first commit if needed ---
if (!existsSync(resolve(root, ".git"))) {
  run("git init -b main");
}
const hasCommit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, stdio: "ignore" }).status === 0;
if (!hasCommit) {
  run("git add -A");
  run('git commit -m "chore: initial commit"');
}

// --- 4. ensure remote exists (create the repo if not yet) ---
const repoExists = spawnSync("gh", ["repo", "view", slug], { stdio: "ignore" }).status === 0;
if (!repoExists) {
  const visibility = privateFlag ? "--private" : "--public";
  run(`gh repo create ${slug} ${visibility} --source=. --remote=origin --push`);
  console.log(`created and pushed: https://github.com/${slug}`);
} else {
  console.log("repo already exists on GitHub.");
  let remoteUrl = "";
  try { remoteUrl = capture("git remote get-url origin").trim(); } catch {}
  if (!remoteUrl) {
    run(`git remote add origin https://github.com/${slug}.git`);
  }
  run("git push -u origin main --follow-tags");
}

// ------------------- helpers -------------------

function run(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

function capture(cmd) {
  return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString();
}

function ensure(parts, message) {
  const [bin, ...args] = parts;
  const ok = spawnSync(bin, args, { stdio: "ignore" }).status === 0;
  if (!ok) {
    console.error(`error: ${message}`);
    process.exit(1);
  }
}
