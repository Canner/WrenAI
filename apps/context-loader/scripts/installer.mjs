import { createHash } from "node:crypto";
import { access, chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { CANONICAL_BINARY, ContextLoaderPackageError, isSha256, readJson, sha256File, targetFor } from "../lib/verified.mjs";

/** Downloads, verifies, and atomically installs the exact manifest row for this package. */
export async function installContextLoader({ packageRoot, fetchImpl = fetch, platform = process.platform, arch = process.arch } = {}) {
  if (typeof packageRoot !== "string") throw new TypeError("packageRoot is required");
  const packageJson = readJson(path.join(packageRoot, "package.json"), "package.json");
  const manifest = readJson(path.join(packageRoot, "artifacts.json"), "artifacts.json");
  const target = targetFor(platform, arch);
  const artifact = manifest.artifacts?.[target];
  validateManifest(packageJson, manifest, artifact, target);

  const binary = path.join(packageRoot, CANONICAL_BINARY);
  const statePath = path.join(packageRoot, "install-state.json");
  const reusable = await existingVerified(binary, statePath, packageJson.version, target, artifact.binarySha256);
  if (reusable) return { binary, reused: true };

  const staging = `${binary}.tmp-${process.pid}-${Date.now()}`;
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
    await mkdir(path.dirname(binary), { recursive: true });
    await writeFile(staging, content, { mode: 0o755 });
    await chmod(staging, 0o755);
    await rename(staging, binary);
    const state = { package: packageJson.name, version: packageJson.version, target, archiveSha256: artifact.archiveSha256, binarySha256: artifact.binarySha256, binaryPath: CANONICAL_BINARY };
    const stateTmp = `${statePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(stateTmp, `${JSON.stringify(state)}\n`, { mode: 0o600 });
    await rename(stateTmp, statePath);
    return { binary, reused: false };
  } catch (error) {
    await rm(staging, { force: true });
    throw error instanceof ContextLoaderPackageError ? error : new ContextLoaderPackageError("download-failed", "could not download the required artifact (offline cache miss)");
  }
}

/**
 * The checked-out source package carries an intentionally empty, pre-release
 * artifact template. Only that exact repository layout skips postinstall;
 * packed packages always download and verify their tagged artifact.
 */
export async function isRepositorySourcePackage(packageRoot) {
  const repositoryRoot = path.resolve(packageRoot, "..", "..");
  if (path.resolve(packageRoot) !== path.join(repositoryRoot, "apps", "context-loader")) return false;
  try {
    await Promise.all([
      access(path.join(repositoryRoot, ".git")),
      access(path.join(repositoryRoot, "pnpm-workspace.yaml")),
      access(path.join(repositoryRoot, "core", "wren", "pyproject.toml")),
    ]);
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

async function existingVerified(binary, statePath, version, target, digest) {
  try {
    const state = JSON.parse(await readFile(statePath, "utf8"));
    return state.version === version && state.target === target && state.binaryPath === CANONICAL_BINARY && state.binarySha256 === digest && sha256File(binary) === digest;
  } catch {
    return false;
  }
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
