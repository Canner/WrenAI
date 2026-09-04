import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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
  const packageJson = readJson(path.join(root, "package.json"), "package.json");
  if (packageJson.name !== PACKAGE_NAME || typeof packageJson.version !== "string") {
    throw new ContextLoaderPackageError("invalid-package", "package.json does not identify this package");
  }
  const state = readJson(path.join(root, STATE_FILE), STATE_FILE);
  const target = targetFor();
  if (state.package !== PACKAGE_NAME || state.version !== packageJson.version || state.target !== target) {
    throw new ContextLoaderPackageError("stale-state", "verification record does not match package version or platform");
  }
  if (!isSha256(state.binarySha256)) {
    throw new ContextLoaderPackageError("invalid-state", "verification record has no binary SHA-256");
  }
  if (state.binaryPath !== CANONICAL_BINARY) {
    throw new ContextLoaderPackageError("invalid-state", "verification record does not name the canonical package-local binary");
  }
  const binary = path.resolve(root, state.binaryPath);
  if (!binary.startsWith(`${root}${path.sep}`) || !existsSync(binary)) {
    throw new ContextLoaderPackageError("missing-binary", "verified package-local binary is absent");
  }
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
