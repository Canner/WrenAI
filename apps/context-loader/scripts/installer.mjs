import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { lstatSync } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { CANONICAL_BINARY, ContextLoaderPackageError, isSha256, sha256File, targetFor } from "../lib/verified.mjs";

const execFile = promisify(execFileCallback);
const SOURCE_ORIGINS = new Set([
  "git@github.com:Canner/WrenAI.git",
  "https://github.com/Canner/WrenAI.git",
  "ssh://git@github.com/Canner/WrenAI.git",
]);

/** Downloads, verifies, and atomically installs the exact manifest row for this package. */
export async function installContextLoader({ packageRoot, fetchImpl = fetch, platform = process.platform, arch = process.arch } = {}) {
  if (typeof packageRoot !== "string") throw new TypeError("packageRoot is required");
  const root = await physicalPackageRoot(packageRoot);
  const packageJson = await readOwnedJson(root, "package.json", "package.json");
  const manifest = await readOwnedJson(root, "artifacts.json", "artifacts.json");
  const target = targetFor(platform, arch);
  const artifact = manifest.artifacts?.[target];
  validateManifest(packageJson, manifest, artifact, target);

  await ensureOwnedDirectory(root, "bin");
  const reusable = await existingVerified(root, packageJson.version, target, artifact.archiveSha256, artifact.binarySha256);
  if (reusable !== undefined) return { binary: reusable, reused: true };

  const binary = path.join(root, CANONICAL_BINARY);
  const statePath = path.join(root, "install-state.json");
  const staging = `${binary}.tmp-${process.pid}-${Date.now()}`;
  let stagingCreated = false;
  try {
    const response = await fetchImpl(artifact.url);
    if (!response?.ok) throw new ContextLoaderPackageError("download-failed", `could not download the ${target} artifact`);
    const archive = Buffer.from(await response.arrayBuffer());
    if (sha256(archive) !== artifact.archiveSha256) {
      throw new ContextLoaderPackageError("archive-digest-mismatch", `downloaded ${target} artifact did not match its SHA-256`);
    }
    const content = extractSingleTarGz(archive, artifact.binaryPath);
    if (sha256(content) !== artifact.binarySha256) {
      throw new ContextLoaderPackageError("binary-digest-mismatch", `extracted ${target} binary did not match its SHA-256`);
    }
    await ensureOwnedDirectory(root, "bin");
    await writeNewOwnedFile(root, path.join("bin", path.basename(staging)), content, 0o755);
    stagingCreated = true;
    await chmod(staging, 0o755);
    await ownedRegularFile(root, path.join("bin", path.basename(staging)));
    await ensureOwnedDirectory(root, "bin");
    await rename(staging, binary);
    stagingCreated = false;
    const installedBinary = await ownedRegularFile(root, CANONICAL_BINARY);
    const state = { package: packageJson.name, version: packageJson.version, target, archiveSha256: artifact.archiveSha256, binarySha256: artifact.binarySha256, binaryPath: CANONICAL_BINARY };
    const stateName = `install-state.json.tmp-${process.pid}-${Date.now()}`;
    const stateTmp = path.join(root, stateName);
    await writeNewOwnedFile(root, stateName, `${JSON.stringify(state)}\n`, 0o600);
    await rename(stateTmp, statePath);
    await ownedRegularFile(root, "install-state.json");
    return { binary: installedBinary, reused: false };
  } catch (error) {
    if (stagingCreated) await removeOwnedFile(root, path.join("bin", path.basename(staging)));
    throw error instanceof ContextLoaderPackageError ? error : new ContextLoaderPackageError("download-failed", "could not download the required artifact (offline cache miss)");
  }
}

/**
 * The checked-out source package carries an intentionally empty, pre-release
 * artifact template. Only that exact repository layout skips postinstall;
 * packed packages always download and verify their tagged artifact.
 */
export async function isRepositorySourcePackage(packageRoot) {
  try {
    if (!lstatSync(packageRoot).isDirectory()) return false;
    const physicalPackage = await realpath(packageRoot);
    const { stdout: repositoryOutput } = await execFile("git", ["-C", physicalPackage, "rev-parse", "--show-toplevel"], { timeout: 2_000 });
    const repositoryRoot = await realpath(repositoryOutput.trim());
    if (physicalPackage !== path.join(repositoryRoot, "apps", "context-loader")) return false;
    const { stdout: originOutput } = await execFile("git", ["-C", repositoryRoot, "remote", "get-url", "origin"], { timeout: 2_000 });
    if (!SOURCE_ORIGINS.has(originOutput.trim())) return false;
    await execFile(
      "git",
      ["-C", repositoryRoot, "ls-files", "--error-unmatch", "--", "apps/context-loader/package.json", "pnpm-workspace.yaml", "core/wren/pyproject.toml"],
      { timeout: 2_000 },
    );
    return true;
  } catch {
    return false;
  }
}

function validateManifest(packageJson, manifest, artifact, target) {
  if (manifest.schema !== 1 || manifest.package !== packageJson.name || manifest.version !== packageJson.version) {
    throw new ContextLoaderPackageError("invalid-manifest", "manifest does not match package identity");
  }
  if (!artifact) throw new ContextLoaderPackageError("unsupported-platform", `${target} has no certified artifact row`);
  if (typeof artifact.url !== "string" || !artifact.url.startsWith("https://") || !isSha256(artifact.archiveSha256) || !isSha256(artifact.binarySha256) || typeof artifact.binaryPath !== "string" || artifact.binaryPath.includes("..") || path.isAbsolute(artifact.binaryPath)) {
    throw new ContextLoaderPackageError("invalid-manifest", `${target} row is incomplete or unsafe`);
  }
}

async function existingVerified(root, version, target, archiveDigest, binaryDigest) {
  try {
    const stateFile = await ownedRegularFile(root, "install-state.json", { allowMissing: true });
    const binary = await ownedRegularFile(root, CANONICAL_BINARY, { allowMissing: true });
    if (stateFile === undefined || binary === undefined) return undefined;
    const state = JSON.parse(await readFile(stateFile, "utf8"));
    return state.version === version && state.target === target && state.binaryPath === CANONICAL_BINARY && state.archiveSha256 === archiveDigest && state.binarySha256 === binaryDigest && sha256File(binary) === binaryDigest ? binary : undefined;
  } catch {
    throw new ContextLoaderPackageError("unsafe-path", "existing install state or binary is linked, malformed, or outside the package root");
  }
}

async function physicalPackageRoot(packageRoot) {
  try {
    if (!(await lstat(packageRoot)).isDirectory()) throw new Error("not a directory");
    return await realpath(packageRoot);
  } catch {
    throw new ContextLoaderPackageError("unsafe-path", "package root is missing, linked, or not a real directory");
  }
}

async function readOwnedJson(root, relativePath, label) {
  const file = await ownedRegularFile(root, relativePath);
  try {
    const value = JSON.parse(await readFile(file, "utf8"));
    if (typeof value !== "object" || value === null) throw new Error("not an object");
    return value;
  } catch {
    throw new ContextLoaderPackageError("invalid-manifest", `${label} is missing or invalid JSON`);
  }
}

async function ensureOwnedDirectory(root, relativePath) {
  const directory = path.join(root, relativePath);
  try {
    await mkdir(directory, { recursive: true });
  } catch {
    throw new ContextLoaderPackageError("unsafe-path", "could not create the package-local binary directory");
  }
  try {
    if (!(await lstat(directory)).isDirectory()) throw new Error("not a directory");
    if ((await realpath(directory)) !== directory) throw new Error("linked directory");
  } catch {
    throw new ContextLoaderPackageError("unsafe-path", "package-local binary directory is linked or outside the package root");
  }
}

async function ownedRegularFile(root, relativePath, { allowMissing = false } = {}) {
  const lexical = path.resolve(root, relativePath);
  if (!lexical.startsWith(`${root}${path.sep}`)) throw new ContextLoaderPackageError("unsafe-path", "requested file escapes the package root");
  try {
    if (!(await lstat(lexical)).isFile()) throw new Error("not a regular file");
    const physical = await realpath(lexical);
    if (!physical.startsWith(`${root}${path.sep}`) || !(await stat(physical)).isFile()) throw new Error("not contained");
    return physical;
  } catch (error) {
    if (allowMissing && isMissing(error)) return undefined;
    throw new ContextLoaderPackageError("unsafe-path", "package-local file is linked, missing, or outside the package root");
  }
}

async function writeNewOwnedFile(root, relativePath, content, mode) {
  const lexical = path.resolve(root, relativePath);
  if (!lexical.startsWith(`${root}${path.sep}`)) throw new ContextLoaderPackageError("unsafe-path", "staging file escapes the package root");
  const handle = await open(lexical, "wx", mode);
  try {
    await handle.writeFile(content);
  } finally {
    await handle.close();
  }
}

async function removeOwnedFile(root, relativePath) {
  try {
    const file = await ownedRegularFile(root, relativePath, { allowMissing: true });
    if (file !== undefined) await rm(file, { force: true });
  } catch {
    // Never follow an unexpected link while cleaning up an interrupted install.
  }
}

function isMissing(error) {
  return typeof error === "object" && error !== null && error.code === "ENOENT";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function extractSingleTarGz(archive, expectedPath) {
  let tar;
  try { tar = gunzipSync(archive); } catch { throw new ContextLoaderPackageError("invalid-archive", "artifact is not a gzip tar archive"); }
  let offset = 0;
  let found;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/u, "");
    const sizeText = header.subarray(124, 136).toString("utf8").replace(/\0.*$/u, "").trim();
    const size = Number.parseInt(sizeText || "0", 8);
    const type = String.fromCharCode(header[156] || 48);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) throw new ContextLoaderPackageError("invalid-archive", "artifact has an invalid tar layout");
    if (name === expectedPath) {
      if (type !== "0" || found !== undefined) throw new ContextLoaderPackageError("invalid-archive", "artifact has an unexpected binary layout");
      found = Buffer.from(tar.subarray(offset + 512, offset + 512 + size));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (found === undefined) throw new ContextLoaderPackageError("invalid-archive", "artifact does not contain the declared binary path");
  return found;
}
