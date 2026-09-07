/**
 * Immutable, release-managed Wren runtime for native Codex sessions.
 *
 * The packaged manifest is deliberately staged until the release workflow has
 * mirrored every byte and passed its protected licence-approval environment.
 * This module never substitutes a local checkout, PATH Python, user venv, or
 * upstream URL for a missing approved record.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { NativeWrenRuntime } from "./native-wren-runtime.js";

const SHA256 = z.string().regex(/^[a-f0-9]{64}$/);
const RELATIVE = z.string().min(1).refine((value) => !path.isAbsolute(value) && !value.split(/[\\/]/).includes(".."));
const URL = z.string().url().refine((value) => value.startsWith("https://github.com/Canner/WrenAI/releases/download/"));
const stagedDigest = z.union([SHA256, z.literal("staged")]);

const managedWrenManifestSchema = z.object({
  schema: z.literal(1),
  activation: z.enum(["staged", "approved"]),
  platform: z.literal("darwin-arm64"),
  compatibility: z.object({ genbi: z.string().regex(/^\d+\.\d+\.\d+$/), profile: z.literal("genbi-native-v4"), wren: z.string().regex(/^\d+\.\d+\.\d+$/) }).strict(),
  python: z.object({
    implementation: z.literal("cpython"), version: z.string().regex(/^3\.11\.\d+$/),
    upstream: z.object({ release: z.string().regex(/^\d{8}$/), url: z.string().url(), sha256: SHA256 }).strict(),
    mirror: z.object({ url: URL, sha256: SHA256 }).strict(), interpreterPath: RELATIVE,
  }).strict(),
  wheels: z.array(z.object({ distribution: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/), version: z.string().regex(/^[A-Za-z0-9!+._-]+$/), filename: RELATIVE, url: URL, sourceUrl: z.string().url(), sha256: SHA256 }).strict()).min(1),
  runtime: z.object({ pythonArchivePath: RELATIVE, venvInterpreterPath: RELATIVE, launcherPath: RELATIVE, module: z.literal("wren.cli:app"), packagePath: RELATIVE, sitePackagesPath: RELATIVE, pythonTreeSha256: stagedDigest, packageTreeSha256: stagedDigest, sitePackagesTreeSha256: stagedDigest, closureSha256: stagedDigest }).strict(),
  licenseApproval: z.object({ state: z.enum(["pending", "approved"]), evidence: z.string().min(1).optional() }).strict(),
  approvedManifest: z.object({ url: URL, sha256: SHA256 }).strict().optional(),
}).strict().superRefine((value, context) => {
  if (new Set(value.wheels.map((wheel) => wheel.filename)).size !== value.wheels.length) context.addIssue({ code: "custom", message: "duplicate wheel filename" });
  if (value.wheels[0]?.distribution !== "wrenai" || value.wheels[0].version !== value.compatibility.wren) context.addIssue({ code: "custom", message: "wrenai must be the first exact wheel" });
  const approved = value.activation === "approved";
  if (approved !== (value.licenseApproval.state === "approved") || (approved && (!value.licenseApproval.evidence || value.runtime.pythonTreeSha256 === "staged" || value.runtime.packageTreeSha256 === "staged" || value.runtime.sitePackagesTreeSha256 === "staged" || value.runtime.closureSha256 === "staged"))) {
    context.addIssue({ code: "custom", message: "activation requires approved licence evidence and attested digests" });
  }
});

export type ManagedWrenManifest = Readonly<z.infer<typeof managedWrenManifestSchema>>;
export class ManagedWrenRuntimeError extends Error { constructor(readonly code: ManagedWrenFailureCode, message = code) { super(message); } }
export type ManagedWrenFailureCode = "codex_wren_manifest_missing" | "codex_wren_manifest_invalid" | "codex_wren_platform_unsupported" | "codex_wren_runtime_unprovisioned" | "codex_wren_provision_failed" | "codex_wren_interpreter_mismatch" | "codex_wren_launcher_mismatch" | "codex_wren_package_mismatch" | "codex_wren_closure_mismatch";

export interface ManagedWrenRuntimeRecord extends NativeWrenRuntime {
  readonly manifest_digest: string;
  readonly generation_root: string;
  readonly closure_digest: string;
  readonly package_digest: string;
}

function failure(code: ManagedWrenFailureCode): never { throw new ManagedWrenRuntimeError(code); }
function sha256(value: Uint8Array | string): string { return createHash("sha256").update(value).digest("hex"); }
function contained(root: string, target: string): boolean { const relative = path.relative(root, target); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); }
function platform(): "darwin-arm64" | undefined { return process.platform === "darwin" && process.arch === "arm64" ? "darwin-arm64" : undefined; }
function packageRoot(): string {
  const parent = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  // Source runs from <package>/server; the packed server runs from
  // <package>/dist-server/server. Both must read the package-owned manifest.
  return path.basename(parent) === "dist-server" ? path.resolve(parent, "..") : parent;
}
export function defaultManagedWrenRoot(): string { return path.join(os.homedir(), "Library", "Application Support", "WrenAI", "genbi", "managed-wren"); }
export function managedWrenManifestPath(root = packageRoot()): string { return path.join(root, "managed-wren", "manifest.json"); }

export function readManagedWrenManifest(root = packageRoot()): ManagedWrenManifest {
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(managedWrenManifestPath(root), "utf8")); } catch { return failure("codex_wren_manifest_missing"); }
  const parsed = managedWrenManifestSchema.safeParse(raw);
  if (!parsed.success) return failure("codex_wren_manifest_invalid");
  if (platform() !== parsed.data.platform) return failure("codex_wren_platform_unsupported");
  return Object.freeze(parsed.data);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
export function manifestDigest(manifest: ManagedWrenManifest): string { return sha256(stableJson(manifest)); }
function immutableDirectory(root: string, digest: string): string { return path.join(root, digest); }
function assertPrivateDirectory(directory: string): void {
  try { const entry = lstatSync(directory); if (!entry.isDirectory() || entry.isSymbolicLink() || realpathSync(directory) !== directory || (entry.mode & 0o777) !== 0o700) failure("codex_wren_runtime_unprovisioned"); } catch (error) { if (error instanceof ManagedWrenRuntimeError) throw error; failure("codex_wren_runtime_unprovisioned"); }
}
function assertContainedRealpath(root: string, target: string, code: ManagedWrenFailureCode): string {
  try { const canonical = realpathSync(target); if (!contained(root, canonical)) failure(code); return canonical; } catch (error) { if (error instanceof ManagedWrenRuntimeError) throw error; return failure(code); }
}
function regularExecutable(root: string, target: string, code: ManagedWrenFailureCode): string {
  const canonical = assertContainedRealpath(root, target, code); const metadata = statSync(canonical); if (!metadata.isFile() || (metadata.mode & 0o111) === 0) failure(code); return canonical;
}
function regularFile(root: string, target: string, code: ManagedWrenFailureCode): string {
  const canonical = assertContainedRealpath(root, target, code); const metadata = statSync(canonical); if (!metadata.isFile()) failure(code); return canonical;
}
function assertSecureTree(root: string, code: ManagedWrenFailureCode): void {
  try {
    const visit = (directory: string) => {
      for (const name of readdirSync(directory)) {
        const target = path.join(directory, name); const entry = lstatSync(target);
        if ((entry.mode & 0o022) !== 0) failure(code);
        if (entry.isSymbolicLink()) { assertContainedRealpath(root, target, code); continue; }
        if (entry.isDirectory()) visit(target); else if (!entry.isFile()) failure(code);
      }
    };
    visit(root);
  } catch (error) { if (error instanceof ManagedWrenRuntimeError) throw error; failure(code); }
}
export function managedWrenTreeDigest(root: string): string {
  const entries: string[] = [];
  const visit = (directory: string) => { for (const name of readdirSync(directory).sort()) { if (name === "__pycache__") continue; const target = path.join(directory, name); const stat = lstatSync(target); const mode = (stat.mode & 0o777).toString(8); if (stat.isSymbolicLink()) { const canonical = realpathSync(target); if (!contained(root, canonical)) throw new Error("link escape"); entries.push(`${path.relative(root, target)}\0${mode}\0link\0${readlinkSync(target)}`); } else if (stat.isDirectory()) visit(target); else if (stat.isFile()) entries.push(`${path.relative(root, target)}\0${mode}\0file\0${sha256(readFileSync(target))}`); else throw new Error("special"); } };
  visit(root); return sha256(entries.join("\n"));
}
function closureDigest(manifest: ManagedWrenManifest): string { return sha256(manifest.wheels.map((wheel) => `${wheel.filename}\0${wheel.sha256}`).sort().join("\n")); }
function ownershipMarker(root: string): string { return path.join(root, ".genbi-managed-wren.json"); }
function approvedManifestCache(root: string, digest: string): string { return path.join(root, "attestations", `${digest}.json`); }
function sameReleaseIdentity(staged: ManagedWrenManifest, approved: ManagedWrenManifest): boolean {
  return JSON.stringify(staged.compatibility) === JSON.stringify(approved.compatibility) &&
    JSON.stringify(staged.python) === JSON.stringify(approved.python) &&
    staged.wheels.length === approved.wheels.length && staged.wheels.every((wheel, index) => JSON.stringify(wheel) === JSON.stringify(approved.wheels[index]));
}
function activatedManifest(base: ManagedWrenManifest, root: string): ManagedWrenManifest {
  if (base.activation === "approved") return base;
  if (!base.approvedManifest) return failure("codex_wren_runtime_unprovisioned");
  try {
    const cache = approvedManifestCache(root, base.approvedManifest.sha256);
    assertPrivateDirectory(path.dirname(cache));
    const entry = lstatSync(cache);
    if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o777) !== 0o600) return failure("codex_wren_manifest_invalid");
    const bytes = readFileSync(cache);
    if (sha256(bytes) !== base.approvedManifest.sha256) return failure("codex_wren_manifest_invalid");
    const parsed = managedWrenManifestSchema.safeParse(JSON.parse(bytes.toString("utf8")));
    if (!parsed.success || parsed.data.activation !== "approved" || parsed.data.platform !== base.platform || !sameReleaseIdentity(base, parsed.data)) return failure("codex_wren_manifest_invalid");
    return Object.freeze(parsed.data);
  } catch (error) { if (error instanceof ManagedWrenRuntimeError) throw error; return failure("codex_wren_runtime_unprovisioned"); }
}
async function cacheApprovedManifest(base: ManagedWrenManifest, root: string): Promise<ManagedWrenManifest> {
  if (base.activation === "approved") return base;
  // A byte-identical cached record is the first choice.  Do not turn a local
  // cache corruption into a network recovery path: the package anchor is the
  // authority, and a bad cache is an integrity failure.
  try { return activatedManifest(base, root); } catch (error) {
    if (!(error instanceof ManagedWrenRuntimeError) || error.code !== "codex_wren_runtime_unprovisioned") throw error;
  }
  if (!base.approvedManifest) return failure("codex_wren_runtime_unprovisioned");
  const response = await fetch(base.approvedManifest.url); if (!response.ok) return failure("codex_wren_provision_failed");
  const bytes = Buffer.from(await response.arrayBuffer()); if (sha256(bytes) !== base.approvedManifest.sha256) return failure("codex_wren_manifest_invalid");
  const cache = approvedManifestCache(root, base.approvedManifest.sha256); mkdirSync(path.dirname(cache), { recursive: true, mode: 0o700 }); chmodSync(path.dirname(cache), 0o700); assertPrivateDirectory(path.dirname(cache));
  try { writeFileSync(cache, bytes, { mode: 0o600, flag: "wx" }); } catch (error: any) {
    // The provision lock prevents this in normal operation.  Preserve this
    // compare-and-accept branch for a cross-version contender that already
    // populated the same exact anchor while this process was starting.
    if (error?.code !== "EEXIST") throw error;
  }
  return activatedManifest(base, root);
}
function stagingMarker(root: string): string { return path.join(root, ".genbi-managed-wren-staging.json"); }
function actualClosureDigest(root: string, manifest: ManagedWrenManifest): string {
  const hashes: string[] = [];
  for (const wheel of manifest.wheels) {
    const target = regularFile(root, path.join(root, "wheels", wheel.filename), "codex_wren_closure_mismatch");
    const actual = sha256(readFileSync(target)); if (actual !== wheel.sha256) failure("codex_wren_closure_mismatch");
    hashes.push(`${wheel.filename}\0${actual}`);
  }
  return sha256(hashes.sort().join("\n"));
}
function isRecognisedStaging(root: string, candidate: string, digest: string): boolean {
  try {
    const target = path.join(root, candidate); const entry = lstatSync(target);
    if (!entry.isDirectory() || entry.isSymbolicLink() || !contained(root, target) || (entry.mode & 0o777) !== 0o700) return false;
    const marker = stagingMarker(target); const markerEntry = lstatSync(marker);
    if (!markerEntry.isFile() || markerEntry.isSymbolicLink() || (markerEntry.mode & 0o777) !== 0o600) return false;
    return JSON.parse(readFileSync(marker, "utf8")).manifestDigest === digest;
  } catch { return false; }
}
function cleanupRecognisedStaging(root: string, digest: string): void {
  for (const candidate of readdirSync(root)) {
    if (!candidate.startsWith(`.staging-${digest}-`) || !isRecognisedStaging(root, candidate, digest)) continue;
    rmSync(path.join(root, candidate), { recursive: true, force: true });
  }
}
function reclaimStaleLock(lock: string): boolean {
  try {
    const entry = lstatSync(lock); if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o777) !== 0o600) return false;
    const record = JSON.parse(readFileSync(lock, "utf8")); if (!Number.isInteger(record.pid) || record.pid <= 0) return false;
    try { process.kill(record.pid, 0); return false; } catch (error: any) { if (error?.code !== "ESRCH") return false; }
    // O_EXCL elects one reclaimer. It then hard-links the *current* lock before
    // unlinking its public name; another provisioner cannot create a new O_EXCL
    // lock until that unlink, and a live replacement is never renamed/deleted.
    const claim = `${lock}.reclaim`;
    try { const old = JSON.parse(readFileSync(claim, "utf8")); process.kill(old.pid, 0); return false; } catch (error: any) { if (error?.code === "ESRCH") { const guard = `${claim}.recover-${process.pid}`; try { linkSync(claim, guard); if (JSON.parse(readFileSync(guard, "utf8")).pid === JSON.parse(readFileSync(claim, "utf8")).pid) unlinkSync(claim); } catch {} finally { try { unlinkSync(guard); } catch {} } } else if (error?.code !== "ENOENT") return false; }
    let claimDescriptor: number | undefined;
    const nonce = sha256(`${process.pid}\0${Date.now()}\0${Math.random()}`);
    try { claimDescriptor = openSync(claim, "wx", 0o600); writeFileSync(claimDescriptor, JSON.stringify({ pid: process.pid, nonce }) + "\n"); } catch (error: any) { if (error?.code === "EEXIST") return false; throw error; }
    const linked = `${claim}.lock`;
    try {
      linkSync(lock, linked);
      const claimed = statSync(linked); const current = statSync(lock);
      const claimedRecord = JSON.parse(readFileSync(linked, "utf8"));
      if (claimed.ino !== current.ino || claimedRecord.pid !== record.pid || JSON.parse(readFileSync(claim, "utf8")).nonce !== nonce) return false;
      unlinkSync(lock); return true;
    } finally { try { unlinkSync(linked); } catch {} try { const guard = `${claim}.owner-${nonce}`; linkSync(claim, guard); if (JSON.parse(readFileSync(guard, "utf8")).nonce === nonce) unlinkSync(claim); unlinkSync(guard); } catch {} }
  } catch { return false; }
}
function assertSafeArchive(archive: string): void {
  const verifier = "import posixpath,sys,tarfile\ndef safe(value):\n return value not in ('.','') and not value.startswith('/') and value != '..' and not value.startswith('../')\nwith tarfile.open(sys.argv[1],'r:gz') as archive:\n for member in archive.getmembers():\n  name=posixpath.normpath(member.name)\n  if name == '.': continue\n  if not safe(name): raise SystemExit('unsafe archive member')\n  if member.issym(): target=posixpath.normpath(posixpath.join(posixpath.dirname(name),member.linkname))\n  elif member.islnk(): target=posixpath.normpath(member.linkname)\n  else: continue\n  if not safe(target): raise SystemExit('unsafe archive link')\n";
  execFileSync("/usr/bin/python3", ["-c", verifier, archive], { stdio: "ignore" });
}
function relocateVenvConfig(staging: string, destination: string, manifest: ManagedWrenManifest): void {
  const config = path.join(destination, "venv", "pyvenv.cfg");
  const entry = lstatSync(config); if (!entry.isFile() || entry.isSymbolicLink()) failure("codex_wren_interpreter_mismatch");
  const original = readFileSync(config, "utf8");
  if (!/^home\s*=\s*.+$/m.test(original) || !/^executable\s*=\s*.+$/m.test(original)) failure("codex_wren_interpreter_mismatch");
  const updated = original.split(staging).join(destination);
  if (updated.includes(staging)) failure("codex_wren_interpreter_mismatch");
  const expected = { home: path.dirname(path.join(destination, manifest.python.interpreterPath)), executable: path.join(destination, manifest.python.interpreterPath) };
  for (const [key, target] of Object.entries(expected)) if (updated.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, "m"))?.[1]?.trim() !== target) failure("codex_wren_interpreter_mismatch");
  writeFileSync(config, updated, { mode: 0o600 });
}
function assertRelocatedVenvConfig(destination: string, manifest: ManagedWrenManifest): void {
  const config = path.join(destination, "venv", "pyvenv.cfg");
  try {
    const entry = lstatSync(config); if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o022) !== 0) failure("codex_wren_interpreter_mismatch");
    const text = readFileSync(config, "utf8");
    const expected = { home: path.dirname(path.join(destination, manifest.python.interpreterPath)), executable: path.join(destination, manifest.python.interpreterPath) };
    for (const [key, target] of Object.entries(expected)) if (text.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, "m"))?.[1]?.trim() !== target) failure("codex_wren_interpreter_mismatch");
  } catch (error) { if (error instanceof ManagedWrenRuntimeError) throw error; failure("codex_wren_interpreter_mismatch"); }
}

/**
 * Remove only records that were previously returned by this module and that
 * the caller has established are neither active nor required for rollback.
 *
 * Generation selection belongs to the host/session lifecycle, not to a
 * directory sweep: accepting arbitrary paths here would make cleanup an
 * unsafe deletion primitive.  A concurrent provisioner conservatively blocks
 * cleanup altogether; it can retry after the writer releases its lock.
 */
export function cleanupManagedWrenGenerations(options: {
  readonly runtimeRoot?: string;
  readonly candidates: readonly ManagedWrenRuntimeRecord[];
  readonly retainManifestDigests: readonly string[];
}): readonly string[] {
  const root = options.runtimeRoot ?? defaultManagedWrenRoot();
  try { assertPrivateDirectory(root); } catch { return []; }
  if (existsSync(path.join(root, ".provision.lock"))) return [];
  const retained = new Set(options.retainManifestDigests);
  const removed: string[] = [];
  for (const record of options.candidates) {
    if (retained.has(record.manifest_digest) || removed.includes(record.manifest_digest)) continue;
    const generation = immutableDirectory(root, record.manifest_digest);
    if (record.generation_root !== generation) continue;
    try {
      assertPrivateDirectory(generation);
      const markerPath = ownershipMarker(generation);
      const markerEntry = lstatSync(markerPath);
      if (!markerEntry.isFile() || markerEntry.isSymbolicLink() || (markerEntry.mode & 0o777) !== 0o600) continue;
      const marker = JSON.parse(readFileSync(markerPath, "utf8")) as Record<string, unknown>;
      if (marker.manifestDigest !== record.manifest_digest || marker.closureDigest !== record.closure_digest || marker.packageDigest !== record.package_digest) continue;
      // Re-check every executable/path the record would hand to a session
      // before removing it. This makes a stale or caller-forged record a no-op.
      if (!contained(generation, record.launcher) || !contained(generation, record.interpreter) ||
        !contained(generation, record.venv_python) || !contained(generation, record.source_root)) continue;
      regularExecutable(generation, record.launcher, "codex_wren_launcher_mismatch");
      regularExecutable(generation, record.interpreter, "codex_wren_interpreter_mismatch");
      regularExecutable(generation, record.venv_python, "codex_wren_interpreter_mismatch");
      assertContainedRealpath(generation, record.source_root, "codex_wren_package_mismatch");
      rmSync(generation, { recursive: true, force: false });
      removed.push(record.manifest_digest);
    } catch {
      // An unrecognised, changed, or concurrently replaced entry is retained.
    }
  }
  return Object.freeze(removed);
}

/** Revalidate a record before every native Codex launch. */
export function resolveManagedWrenRuntime(options: { readonly packageRoot?: string; readonly runtimeRoot?: string } = {}): ManagedWrenRuntimeRecord {
  const base = readManagedWrenManifest(options.packageRoot); const root = options.runtimeRoot ?? defaultManagedWrenRoot(); const manifest = activatedManifest(base, root);
  const digest = manifestDigest(manifest); const generation = immutableDirectory(root, digest);
  assertPrivateDirectory(root); assertPrivateDirectory(generation);
  assertSecureTree(generation, "codex_wren_closure_mismatch");
  let marker: { manifestDigest?: unknown; closureDigest?: unknown; pythonTreeDigest?: unknown; packageDigest?: unknown; sitePackagesDigest?: unknown; interpreterDigest?: unknown; launcherDigest?: unknown };
  try { const markerPath = ownershipMarker(generation); const entry = lstatSync(markerPath); if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o777) !== 0o600) return failure("codex_wren_runtime_unprovisioned"); marker = JSON.parse(readFileSync(markerPath, "utf8")); } catch { return failure("codex_wren_runtime_unprovisioned"); }
  if (marker.manifestDigest !== digest) return failure("codex_wren_closure_mismatch");
  const archive = regularFile(generation, path.join(generation, manifest.runtime.pythonArchivePath), "codex_wren_interpreter_mismatch");
  if (sha256(readFileSync(archive)) !== manifest.python.mirror.sha256) return failure("codex_wren_interpreter_mismatch");
  if (managedWrenTreeDigest(path.join(generation, "python")) !== manifest.runtime.pythonTreeSha256 || marker.pythonTreeDigest !== manifest.runtime.pythonTreeSha256) return failure("codex_wren_interpreter_mismatch");
  const interpreter = regularExecutable(generation, path.join(generation, manifest.runtime.venvInterpreterPath), "codex_wren_interpreter_mismatch");
  assertRelocatedVenvConfig(generation, manifest);
  const launcher = regularExecutable(generation, path.join(generation, manifest.runtime.launcherPath), "codex_wren_launcher_mismatch");
  if (marker.interpreterDigest !== sha256(readFileSync(interpreter))) return failure("codex_wren_interpreter_mismatch");
  if (marker.launcherDigest !== sha256(readFileSync(launcher))) return failure("codex_wren_launcher_mismatch");
  let launcherText = ""; try { launcherText = readFileSync(launcher, "utf8"); } catch { return failure("codex_wren_launcher_mismatch"); }
  if (!launcherText.startsWith(`#!${path.join(generation, manifest.runtime.venvInterpreterPath)}`) || !launcherText.includes("from wren.cli import app")) return failure("codex_wren_launcher_mismatch");
  const packagePath = assertContainedRealpath(generation, path.join(generation, manifest.runtime.packagePath), "codex_wren_package_mismatch");
  const sitePackages = assertContainedRealpath(generation, path.join(generation, manifest.runtime.sitePackagesPath), "codex_wren_package_mismatch");
  let actualPackage: string; try { actualPackage = managedWrenTreeDigest(packagePath); } catch { return failure("codex_wren_package_mismatch"); }
  if (actualPackage !== manifest.runtime.packageTreeSha256 || marker.packageDigest !== actualPackage) return failure("codex_wren_package_mismatch");
  let actualSitePackages: string; try { actualSitePackages = managedWrenTreeDigest(sitePackages); } catch { return failure("codex_wren_package_mismatch"); }
  if (actualSitePackages !== manifest.runtime.sitePackagesTreeSha256 || marker.sitePackagesDigest !== actualSitePackages) return failure("codex_wren_package_mismatch");
  const actualClosure = actualClosureDigest(generation, manifest); if (actualClosure !== manifest.runtime.closureSha256 || marker.closureDigest !== actualClosure) return failure("codex_wren_closure_mismatch");
  const python = regularExecutable(generation, path.join(generation, manifest.python.interpreterPath), "codex_wren_interpreter_mismatch");
  return Object.freeze({ version: "1", shim: launcher, launcher, venv_python: interpreter, tool_root: path.join(generation, "venv"), site_packages: path.dirname(packagePath), source_root: packagePath, interpreter: python, interpreter_root: path.dirname(path.dirname(python)), manifest_digest: digest, generation_root: generation, closure_digest: actualClosure, package_digest: actualPackage });
}

/**
 * Readiness is deliberately resolve-only: checking any RuntimeHost backend
 * must neither create the GenBI runtime root nor fetch/install managed bytes.
 * An explicit future first-use path may call the exported provisioner below.
 */
export function managedWrenReadinessFailure(options: { readonly packageRoot?: string; readonly runtimeRoot?: string } = {}): ManagedWrenFailureCode | undefined {
  try {
    resolveManagedWrenRuntime(options);
    return undefined;
  } catch (error) {
    return error instanceof ManagedWrenRuntimeError ? error.code : "codex_wren_runtime_unprovisioned";
  }
}

/**
 * Provision is intentionally unavailable for a staged manifest. A release can
 * only turn this on after the protected licence approval job writes an approved
 * manifest with release-attested digests.
 */
export async function provisionManagedWrenRuntime(options: { readonly packageRoot?: string; readonly runtimeRoot?: string } = {}): Promise<ManagedWrenRuntimeRecord> {
  const root = options.runtimeRoot ?? defaultManagedWrenRoot();
  mkdirSync(root, { recursive: true, mode: 0o700 }); chmodSync(root, 0o700); assertPrivateDirectory(root);
  const base = readManagedWrenManifest(options.packageRoot);
  // An approved package can avoid the lock entirely.  A staged package takes
  // the same lock for cache population and provision, so concurrent first use
  // cannot observe an absent/half-written approved-manifest cache.
  if (base.activation === "approved") {
    try { return resolveManagedWrenRuntime({ ...(options.packageRoot ? { packageRoot: options.packageRoot } : {}), runtimeRoot: root }); } catch (error) { if (!(error instanceof ManagedWrenRuntimeError) || error.code !== "codex_wren_runtime_unprovisioned") throw error; }
  }
  const lock = path.join(root, ".provision.lock"); let descriptor: number | undefined; let provisionDigest: string | undefined;
  try {
    // A second first-use caller waits for the owner instead of falling through
    // to a partial directory or declaring a separate runtime valid.
    const deadline = Date.now() + 10_000;
    while (descriptor === undefined && Date.now() < deadline) {
      try { descriptor = openSync(lock, "wx", 0o600); writeFileSync(descriptor, JSON.stringify({ pid: process.pid, manifestDigest: base.activation === "approved" ? manifestDigest(base) : base.approvedManifest?.sha256 ?? "pending" }) + "\n"); } catch (error: unknown) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
        if (reclaimStaleLock(lock)) continue;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    if (descriptor === undefined) return failure("codex_wren_provision_failed");
    let manifest: ManagedWrenManifest;
    try { manifest = await cacheApprovedManifest(base, root); } catch (error) { if (error instanceof ManagedWrenRuntimeError) throw error; return failure("codex_wren_provision_failed"); }
    const digest = manifestDigest(manifest); provisionDigest = digest; const destination = immutableDirectory(root, digest);
    // A waiter must re-check after it owns the lock: the original owner may
    // have completed while this caller was waiting.
    try { return resolveManagedWrenRuntime({ ...(options.packageRoot ? { packageRoot: options.packageRoot } : {}), runtimeRoot: root }); } catch (error) { if (!(error instanceof ManagedWrenRuntimeError) || error.code !== "codex_wren_runtime_unprovisioned") throw error; }
    // Only a marker written by this provisioner is eligible for interrupted-run
    // recovery, after the exclusive lock prevents a live writer race.
    cleanupRecognisedStaging(root, digest);
    const staging = path.join(root, `.staging-${digest}-${process.pid}`); mkdirSync(staging, { mode: 0o700 }); chmodSync(staging, 0o700);
    writeFileSync(stagingMarker(staging), JSON.stringify({ manifestDigest: digest }) + "\n", { mode: 0o600, flag: "wx" });
    // The release workflow makes these assets available as a closed mirror.
    // Fetching any other URL, index, or dependency resolver is intentionally absent.
    const archive = path.join(staging, manifest.runtime.pythonArchivePath); const download = async (url: string, target: string, expected: string) => { const response = await fetch(url); if (!response.ok) throw new Error("download"); const bytes = Buffer.from(await response.arrayBuffer()); if (sha256(bytes) !== expected) throw new Error("digest"); writeFileSync(target, bytes, { mode: 0o600, flag: "wx" }); };
    await download(manifest.python.mirror.url, archive, manifest.python.mirror.sha256);
    assertSafeArchive(archive); execFileSync("/usr/bin/tar", ["-xpzf", archive, "-C", staging], { stdio: "ignore" }); chmodSync(staging, 0o700);
    const python = path.join(staging, manifest.python.interpreterPath); regularExecutable(staging, python, "codex_wren_interpreter_mismatch");
    const wheels = path.join(staging, "wheels"); mkdirSync(wheels, { mode: 0o700 });
    for (const wheel of manifest.wheels) await download(wheel.url, path.join(wheels, wheel.filename), wheel.sha256);
    const requirements = manifest.wheels.map((wheel) => `${wheel.distribution}==${wheel.version} --hash=sha256:${wheel.sha256}`).join("\n") + "\n";
    writeFileSync(path.join(staging, "requirements.txt"), requirements, { mode: 0o600, flag: "wx" });
    const venv = path.join(staging, "venv"); execFileSync(python, ["-m", "venv", "--copies", venv], { stdio: "ignore", env: { PATH: path.dirname(python), HOME: staging, PYTHONNOUSERSITE: "1" } });
    const venvInterpreter = path.join(venv, "bin", "python");
    // PBS may still emit an absolute staging symlink despite --copies. Replace
    // only that resolved interpreter with a private copy before promotion.
    if (lstatSync(venvInterpreter).isSymbolicLink()) { const resolved = realpathSync(venvInterpreter); if (!contained(staging, resolved)) return failure("codex_wren_interpreter_mismatch"); unlinkSync(venvInterpreter); writeFileSync(venvInterpreter, readFileSync(resolved), { mode: 0o700 }); }
    execFileSync(path.join(venv, "bin", "python"), ["-m", "pip", "install", "--no-index", "--no-deps", "--require-hashes", "--find-links", wheels, "-r", path.join(staging, "requirements.txt")], { stdio: "ignore", env: { PATH: path.join(venv, "bin"), HOME: staging, PYTHONNOUSERSITE: "1" } });
    const packagePath = path.join(staging, manifest.runtime.packagePath); const sitePackagesPath = path.join(staging, manifest.runtime.sitePackagesPath); const pythonTreeDigest = managedWrenTreeDigest(path.join(staging, "python")); const packageDigest = managedWrenTreeDigest(packagePath); const sitePackagesDigest = managedWrenTreeDigest(sitePackagesPath); const closure = actualClosureDigest(staging, manifest);
    if (pythonTreeDigest !== manifest.runtime.pythonTreeSha256 || packageDigest !== manifest.runtime.packageTreeSha256 || sitePackagesDigest !== manifest.runtime.sitePackagesTreeSha256 || closure !== manifest.runtime.closureSha256) throw new Error("attestation");
    // `venv` console launchers contain an absolute interpreter shebang. The
    // staging name must never escape into an active generation after rename.
    const stagedInterpreter = path.join(staging, manifest.runtime.venvInterpreterPath);
    const stagedLauncher = path.join(staging, manifest.runtime.launcherPath);
    const launcherText = readFileSync(stagedLauncher, "utf8");
    if (!launcherText.startsWith(`#!${stagedInterpreter}\n`) || !launcherText.includes("from wren.cli import app")) return failure("codex_wren_launcher_mismatch");
    renameSync(staging, destination);
    relocateVenvConfig(staging, destination, manifest);
    const finalInterpreter = path.join(destination, manifest.runtime.venvInterpreterPath);
    const finalLauncher = path.join(destination, manifest.runtime.launcherPath);
    writeFileSync(finalLauncher, `#!${finalInterpreter}\n${launcherText.slice(stagedInterpreter.length + 3)}`, { mode: 0o700 });
    rmSync(stagingMarker(destination), { force: true });
    writeFileSync(ownershipMarker(destination), JSON.stringify({ manifestDigest: digest, pythonTreeDigest, packageDigest, sitePackagesDigest, closureDigest: closure, interpreterDigest: sha256(readFileSync(finalInterpreter)), launcherDigest: sha256(readFileSync(finalLauncher)) }) + "\n", { mode: 0o600, flag: "wx" });
    return resolveManagedWrenRuntime({ ...(options.packageRoot ? { packageRoot: options.packageRoot } : {}), runtimeRoot: root });
  } catch (error) { if (descriptor !== undefined && provisionDigest) cleanupRecognisedStaging(root, provisionDigest); if (error instanceof ManagedWrenRuntimeError) throw error; return failure("codex_wren_provision_failed");
  } finally { if (descriptor !== undefined) { try { rmSync(lock, { force: true }); } catch { /* next run reports unavailable */ } } }
}

export function managedWrenClosureDigest(manifest: ManagedWrenManifest): string { return closureDigest(manifest); }
