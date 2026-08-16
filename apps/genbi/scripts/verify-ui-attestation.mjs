import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const file = process.env.WREN_GENBI_LAUNCH_ATTESTATION;
const fail = (message) => { process.stderr.write(`error: ${message}\n`); process.exit(1); };
if (!file) fail("WREN_GENBI_LAUNCH_ATTESTATION is required; run verify:launch first");
let attestation;
try { attestation = JSON.parse(readFileSync(file, "utf8")); } catch { fail("local launch attestation cannot be read"); }
const run = (args) => spawnSync("git", args, { cwd: process.cwd(), encoding: "utf8" });
const rootResult = run(["rev-parse", "--show-toplevel"]);
if (rootResult.status !== 0) fail("UI cwd is not a git worktree");
const root = path.resolve(rootResult.stdout.trim());
const status = run(["status", "--porcelain=v1", "--untracked-files=all"]);
if (status.status !== 0 || status.stdout.trim()) fail("UI worktree has tracked or untracked source changes");
const commit = run(["rev-parse", "HEAD"]);
if (commit.status !== 0) fail("UI worktree commit is unavailable");
const rootDigest = createHash("sha256").update(root).digest("hex");
const treeIdentity = createHash("sha256").update(`${rootDigest}\0${commit.stdout.trim()}`).digest("hex");
if (!attestation?.genbi || !attestation?.ui || attestation.genbi.rootDigest !== rootDigest || attestation.genbi.commit !== commit.stdout.trim() || attestation.genbi.treeIdentity !== treeIdentity || JSON.stringify(attestation.ui) !== JSON.stringify(attestation.genbi)) fail("local launch attestation belongs to a different UI worktree");
