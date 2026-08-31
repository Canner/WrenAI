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
const pathDigest = (filePath) => createHash("sha256").update(filePath).digest("hex");
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
function codexSourceIdentity(bin) {
  let sourceRoot = bin;
  let declaredVersion;
  for (let candidate = path.dirname(bin); candidate !== path.dirname(candidate); candidate = path.dirname(candidate)) {
    const packageFile = path.join(candidate, "package.json");
    if (!existsSync(packageFile)) continue;
    try {
      const metadata = JSON.parse(readFileSync(packageFile, "utf8"));
      if (metadata?.name === "@openai/codex") { sourceRoot = candidate; declaredVersion = metadata.version; break; }
    } catch { /* Not the selected Codex package root. */ }
  }
  return {
    sourceRoot,
    source: sourceRoot === bin ? "standalone" : "npm:@openai/codex",
    declaredVersion,
    sourceClosureSha256: sourceRoot === bin ? sha256(bin) : hashTree(sourceRoot),
  };
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
if (!process.env.WREN_HARNESS_WORKSPACE_ROOT) fail("BFF mode/root does not match local launch attestation");
const modeInput = canonicalBootstrapRoot(process.env.WREN_HARNESS_WORKSPACE_ROOT);
if (a.mode !== "bootstrap" || modeInput !== a?.local?.modeInput) fail("BFF mode/root does not match local launch attestation");
// Warble is identified by content hash alone (see binarySha256 check below); the
// attestation carries no commit/rootDigest/treeIdentity for it. cleanGitRoot is still
// used here for the worktree-root and dirty-checkout safety properties it provides on
// the --warble-root the gate selected, independent of what gets attested publicly.
const warble = cleanGitRoot(a?.local?.warbleRoot, "Warble");
if (warble.root !== a?.local?.warbleRoot) fail("BFF Warble checkout does not match local launch attestation");
const inputs = {};
for (const [env, key, kind, containerRoot] of [
  ["WREN_HARNESS_WARBLE_BIN", "warbleBin", "file", warble.root],
  ["WREN_HARNESS_PROFILE", "profile", "directory", genbi.root],
  ["WREN_HARNESS_SETUP_IR", "setupIr", "file", genbi.root],
  ["WREN_HARNESS_ENRICH_IR", "enrichIr", "file", genbi.root],
  ["WREN_HARNESS_ANALYSIS_IR", "analysisIr", "file", genbi.root],
]) {
  if (!process.env[env]) fail(`BFF ${env} does not match local launch attestation`);
  const canonical = kind === "directory" ? directory(process.env[env], env) : regularFile(process.env[env], env);
  if (!contained(containerRoot, canonical) || canonical !== a?.local?.[key]) fail(`BFF ${env} does not match local launch attestation`);
  inputs[key] = canonical;
}
if (sha256(inputs.warbleBin) !== a?.warble?.binarySha256) fail("BFF Warble binary does not match local launch attestation");
const identities = a?.genbi?.runtimeInputs;
if (!identities || hashTree(inputs.profile) !== identities.profileTreeSha256 || sha256(inputs.setupIr) !== identities.setupIrSha256 || sha256(inputs.enrichIr) !== identities.enrichIrSha256 || sha256(inputs.analysisIr) !== identities.analysisIrSha256) fail("BFF profile runtime input content does not match local launch attestation");
if (a?.runtime?.mode !== "subscription" || process.env.WREN_HARNESS_MODE !== "subscription" || process.env.WREN_HARNESS_PROVIDER !== a?.runtime?.provider) fail("BFF runtime does not match local launch attestation");
if (a.runtime.provider === "claude") {
  if (a.runtime.dispatcher !== "claude-agent-sdk" || !process.env.WREN_HARNESS_AGENT_SDK_BIN || process.env.WREN_HARNESS_CODEX_LOCAL_BIN || process.env.WREN_HARNESS_CODEX_BIN) fail("BFF Claude runtime does not match local launch attestation");
  const agentSdkBin = regularFile(process.env.WREN_HARNESS_AGENT_SDK_BIN, "WREN_HARNESS_AGENT_SDK_BIN");
  if (!contained(warble.root, agentSdkBin) || agentSdkBin !== a?.local?.agentSdkBin || sha256(agentSdkBin) !== a.runtime.agentSdkSha256) fail("BFF WREN_HARNESS_AGENT_SDK_BIN does not match local launch attestation");
} else if (a.runtime.provider === "codex") {
  if (a.runtime.dispatcher !== "codex-local" || process.env.WREN_HARNESS_AGENT_SDK_BIN || !process.env.WREN_HARNESS_CODEX_LOCAL_BIN || !process.env.WREN_HARNESS_CODEX_BIN) fail("BFF Codex runtime does not match local launch attestation");
  const codexLocalBin = regularFile(process.env.WREN_HARNESS_CODEX_LOCAL_BIN, "WREN_HARNESS_CODEX_LOCAL_BIN");
  const codexBin = regularFile(process.env.WREN_HARNESS_CODEX_BIN, "WREN_HARNESS_CODEX_BIN");
  if (!contained(warble.root, codexLocalBin) || codexLocalBin !== a?.local?.codexLocalBin || sha256(codexLocalBin) !== a.runtime.codexLocalSha256) fail("BFF WREN_HARNESS_CODEX_LOCAL_BIN does not match local launch attestation");
  const codexSource = codexSourceIdentity(codexBin);
  if (codexBin !== a?.local?.codexBin || pathDigest(codexBin) !== a.runtime.executablePathDigest || sha256(codexBin) !== a.runtime.executableSha256
    || codexSource.sourceRoot !== a?.local?.codexSourceRoot || codexSource.source !== a.runtime.source || codexSource.sourceClosureSha256 !== a.runtime.sourceClosureSha256
    || (codexSource.source !== "standalone" && codexSource.declaredVersion !== a.runtime.version)) fail("BFF WREN_HARNESS_CODEX_BIN does not match local launch attestation");
  const version = spawnSync(codexBin, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (version.status !== 0 || version.stdout.trim() !== `codex-cli ${a.runtime.version}`) fail("BFF Codex executable version does not match local launch attestation");
} else fail("BFF runtime does not match local launch attestation");
