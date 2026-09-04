import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_NAME = "@wrenai/context-loader";
export const STATE_FILE = "install-state.json";
export const CANONICAL_BINARY = path.join("bin", "wren-context-loader");

export class ContextLoaderPackageError extends Error {
  constructor(code, detail) {
    super(`@wrenai/context-loader ${code}: ${detail}`);
    this.name = "ContextLoaderPackageError";
    this.code = code;
  }
}

export function sha256File(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export function targetFor(platform = process.platform, arch = process.arch) {
  return `${platform}-${arch}`;
}

export function packageRootFrom(moduleUrl = import.meta.url) {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), "..");
}

export function readVerifiedState(root = packageRootFrom()) {
  const verifiedRoot = verifiedPackageRoot(root);
  const packageJson = readPackageJson(verifiedRoot);
  if (packageJson.name !== PACKAGE_NAME || typeof packageJson.version !== "string") {
    throw new ContextLoaderPackageError("invalid-package", "package.json does not identify this package");
  }
  const manifest = readManifest(verifiedRoot, packageJson.version);
  const state = readJson(verifiedRegularFile(verifiedRoot, STATE_FILE), STATE_FILE);
  const target = targetFor();
  const artifact = manifest.artifacts?.[target];
  if (!isArtifact(artifact)) {
    throw new ContextLoaderPackageError("invalid-manifest", "artifact manifest has no safe row for this platform");
  }
  if (
    state.package !== PACKAGE_NAME ||
    state.version !== packageJson.version ||
    state.target !== target ||
    state.archiveSha256 !== artifact.archiveSha256 ||
    state.binarySha256 !== artifact.binarySha256
  ) {
    throw new ContextLoaderPackageError("stale-state", "verification record does not match package version or platform");
  }
  if (state.binaryPath !== CANONICAL_BINARY) {
    throw new ContextLoaderPackageError("invalid-state", "verification record does not name the canonical package-local binary");
  }
  const binary = verifiedRegularFile(verifiedRoot, state.binaryPath);
  if (sha256File(binary) !== state.binarySha256) {
    throw new ContextLoaderPackageError("binary-digest-mismatch", "verified package-local binary was modified");
  }
  return { binary, identity: `package:${PACKAGE_NAME}@${packageJson.version}:${target}:${state.binarySha256}`, state };
}

export function resolveVerifiedBinary(root = packageRootFrom()) {
  return readVerifiedState(root).binary;
}

export function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new ContextLoaderPackageError("invalid-state", `${label} is missing or invalid JSON`);
  }
}

export function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function verifiedPackageRoot(root) {
  try {
    if (!lstatSync(root).isDirectory()) throw new Error("not a directory");
    return realpathSync(root);
  } catch {
    throw new ContextLoaderPackageError("invalid-package", "package root is missing or is not a real directory");
  }
}

function readPackageJson(root) {
  return readJson(verifiedRegularFile(root, "package.json"), "package.json");
}

function readManifest(root, version) {
  const manifest = readJson(verifiedRegularFile(root, "artifacts.json"), "artifacts.json");
  if (manifest.schema !== 1 || manifest.package !== PACKAGE_NAME || manifest.version !== version || typeof manifest.artifacts !== "object" || manifest.artifacts === null) {
    throw new ContextLoaderPackageError("invalid-manifest", "artifact manifest does not match package identity");
  }
  return manifest;
}

function isArtifact(artifact) {
  return typeof artifact === "object" && artifact !== null &&
    typeof artifact.url === "string" && artifact.url.startsWith("https://") &&
    isSha256(artifact.archiveSha256) && isSha256(artifact.binarySha256) &&
    typeof artifact.binaryPath === "string" &&
    !artifact.binaryPath.includes("..") && !path.isAbsolute(artifact.binaryPath);
}

function verifiedRegularFile(root, relativePath) {
  const lexicalRoot = path.resolve(root);
  const lexicalFile = path.resolve(lexicalRoot, relativePath);
  if (!lexicalFile.startsWith(`${lexicalRoot}${path.sep}`)) {
    throw new ContextLoaderPackageError("invalid-state", "verification record escapes the package root");
  }
  try {
    if (!lstatSync(lexicalFile).isFile()) throw new Error("not a regular file");
    const physicalFile = realpathSync(lexicalFile);
    if (!physicalFile.startsWith(`${root}${path.sep}`) || !statSync(physicalFile).isFile()) throw new Error("not contained");
    return physicalFile;
  } catch {
    throw new ContextLoaderPackageError("missing-binary", "verified package-local file is absent, linked, or outside the package root");
  }
}
