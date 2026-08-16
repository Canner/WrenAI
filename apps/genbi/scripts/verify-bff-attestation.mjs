import { createHash } from "node:crypto";
import { accessSync, constants, existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const fail = (message) => { process.stderr.write(`error: ${message}\n`); process.exit(1); };
const file = process.env.WREN_GENBI_LAUNCH_ATTESTATION;
let a; try { a = JSON.parse(readFileSync(file, "utf8")); } catch { fail("local launch attestation cannot be read"); }
const git = (args, cwd) => spawnSync("git", args, { cwd, encoding: "utf8" });
const contained = (root, candidate) => { const relative = path.relative(root, candidate); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); };
const sha256 = (filePath) => createHash("sha256").update(readFileSync(filePath)).digest("hex");
function regularFile(value, label) {
  try { const canonical = realpathSync(value); if (!statSync(canonical).isFile()) throw new Error("not a file"); return canonical; }
  catch { fail(`${label} must be a readable regular file`); }
}
function directory(value, label) {
  try { const canonical = realpathSync(value); if (!statSync(canonical).isDirectory()) throw new Error("not a directory"); return canonical; }
  catch { fail(`${label} must be a readable directory`); }
}
function hashTree(root) {
  const digest = createHash("sha256");
  const visit = (directoryPath) => {
    for (const entry of readdirSync(directoryPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const candidate = path.join(directoryPath, entry.name); const relative = path.relative(root, candidate);
      if (entry.isSymbolicLink()) fail(`BFF runtime input must not contain a symlink: ${candidate}`);
      if (entry.isDirectory()) visit(candidate); else if (entry.isFile()) { digest.update(relative); digest.update("\0"); digest.update(readFileSync(candidate)); }
    }
  };
  visit(root); return digest.digest("hex");
}
function canonicalBootstrapRoot(value) {
  const raw = path.resolve(value); let existing = raw; const missing = [];
  while (!existsSync(existing)) { const parent = path.dirname(existing); if (parent === existing) fail("bootstrap workspace has no writable parent"); missing.unshift(path.basename(existing)); existing = parent; }
  if (lstatSync(existing).isSymbolicLink()) fail("bootstrap workspace root or parent must not be a symlink");
  const parent = directory(existing, "bootstrap workspace parent"); const canonical = path.join(parent, ...missing);
  if (!contained(parent, canonical) || missing.some((part) => part === "." || part === ".." || path.basename(part) !== part)) fail("bootstrap workspace root escapes its canonical parent");
  if (existsSync(canonical)) {
    if (lstatSync(canonical).isSymbolicLink()) fail("bootstrap workspace root must not be a symlink");
    const resolved = directory(canonical, "bootstrap workspace root");
    if (existsSync(path.join(resolved, "wren_project.yml"))) fail("bootstrap workspace root must not already be a Wren project");
    for (let ancestor = path.dirname(resolved); ; ancestor = path.dirname(ancestor)) { if (existsSync(path.join(ancestor, "wren_project.yml"))) fail("bootstrap workspace root must not be inside a Wren project"); if (ancestor === path.dirname(ancestor)) break; }
    return resolved;
  }
  for (let ancestor = parent; ; ancestor = path.dirname(ancestor)) { if (existsSync(path.join(ancestor, "wren_project.yml"))) fail("bootstrap workspace root must not be inside a Wren project"); if (ancestor === path.dirname(ancestor)) break; }
  try { accessSync(parent, constants.W_OK | constants.X_OK); } catch { fail("bootstrap workspace parent is not writable"); }
  return canonical;
}
function cleanGitRoot(value, label) {
  const rootResult = git(["-C", value, "rev-parse", "--show-toplevel"]);
  if (rootResult.status !== 0) fail(`${label} is not inside a git worktree`);
  const rootPath = realpathSync(rootResult.stdout.trim());
  const status = git(["-C", rootPath, "status", "--porcelain=v1", "--untracked-files=all"]);
  if (status.status !== 0 || status.stdout.trim()) fail(`${label} worktree has tracked or untracked source changes`);
  const commit = git(["-C", rootPath, "rev-parse", "HEAD"]);
  if (commit.status !== 0) fail(`${label} worktree commit is unavailable`);
  const rootDigest = createHash("sha256").update(rootPath).digest("hex");
  return { root: rootPath, commit: commit.stdout.trim(), rootDigest, treeIdentity: createHash("sha256").update(`${rootDigest}\0${commit.stdout.trim()}`).digest("hex") };
}
const root = git(["rev-parse", "--show-toplevel"], process.cwd());
if (root.status !== 0 || realpathSync(root.stdout.trim()) !== a?.local?.genbiRoot) fail("BFF worktree does not match local launch attestation");
const genbi = cleanGitRoot(root.stdout.trim(), "BFF");
if (a.genbi?.commit !== genbi.commit || a.genbi?.rootDigest !== genbi.rootDigest || a.genbi?.treeIdentity !== genbi.treeIdentity) fail("BFF source provenance does not match local launch attestation");
const mode = process.env.WREN_HARNESS_PROJECT ? "bound" : process.env.WREN_HARNESS_WORKSPACE_ROOT ? "bootstrap" : undefined;
let modeInput;
if (!mode || (process.env.WREN_HARNESS_PROJECT && process.env.WREN_HARNESS_WORKSPACE_ROOT)) fail("BFF mode/root does not match local launch attestation");
if (mode === "bootstrap") modeInput = canonicalBootstrapRoot(process.env.WREN_HARNESS_WORKSPACE_ROOT);
else { modeInput = directory(process.env.WREN_HARNESS_PROJECT, "bound project"); if (!existsSync(path.join(modeInput, "wren_project.yml"))) fail("bound project wren_project.yml is required"); }
if (mode !== a.mode || modeInput !== a?.local?.modeInput) fail("BFF mode/root does not match local launch attestation");
const warble = cleanGitRoot(a?.local?.warbleRoot, "Warble");
if (warble.root !== a?.local?.warbleRoot || a?.warble?.commit !== warble.commit || a?.warble?.rootDigest !== warble.rootDigest || a?.warble?.treeIdentity !== warble.treeIdentity) fail("BFF Warble source provenance does not match local launch attestation");
const inputs = {};
for (const [env, key, kind] of [["WREN_HARNESS_WARBLE_BIN", "warbleBin", "file"], ["WREN_HARNESS_PROFILE", "profile", "directory"], ["WREN_HARNESS_SETUP_IR", "setupIr", "file"], ["WREN_HARNESS_ENRICH_IR", "enrichIr", "file"], ["WREN_HARNESS_ANALYSIS_IR", "analysisIr", "file"]]) {
  if (!process.env[env]) fail(`BFF ${env} does not match local launch attestation`);
  const canonical = kind === "directory" ? directory(process.env[env], env) : regularFile(process.env[env], env);
  if (!contained(warble.root, canonical) || canonical !== a?.local?.[key]) fail(`BFF ${env} does not match local launch attestation`);
  inputs[key] = canonical;
}
if (sha256(inputs.warbleBin) !== a?.warble?.binarySha256) fail("BFF Warble binary does not match local launch attestation");
const identities = a?.warble?.runtimeInputs;
if (!identities || hashTree(inputs.profile) !== identities.profileTreeSha256 || sha256(inputs.setupIr) !== identities.setupIrSha256 || sha256(inputs.enrichIr) !== identities.enrichIrSha256 || sha256(inputs.analysisIr) !== identities.analysisIrSha256) fail("BFF Warble runtime input content does not match local launch attestation");
if (a?.runtime?.mode !== "subscription" || a?.runtime?.provider !== "claude" || a?.runtime?.dispatcher !== "claude-agent-sdk" || process.env.WREN_HARNESS_MODE !== "subscription" || process.env.WREN_HARNESS_PROVIDER !== "claude") fail("BFF runtime does not match local launch attestation");
if (!process.env.WREN_HARNESS_AGENT_SDK_BIN) fail("BFF WREN_HARNESS_AGENT_SDK_BIN does not match local launch attestation");
const agentSdkBin = regularFile(process.env.WREN_HARNESS_AGENT_SDK_BIN, "WREN_HARNESS_AGENT_SDK_BIN");
if (!contained(warble.root, agentSdkBin) || agentSdkBin !== a?.local?.agentSdkBin || sha256(agentSdkBin) !== a?.runtime?.agentSdkSha256) fail("BFF WREN_HARNESS_AGENT_SDK_BIN does not match local launch attestation");
