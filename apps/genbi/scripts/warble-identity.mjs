/**
 * How the launch gate names the Warble in use (decision-87).
 *
 * The gate is written once and re-checked at every BFF boot, in two separate scripts. Both must
 * agree exactly or a launch that verified will refuse to start, so this lives in one module rather
 * than being copied into each -- a contract duplicated across two files is the failure mode this
 * package has already been bitten by once.
 *
 * A pinned npm package does not point at Warble directly: `@warble/cli`'s bin is a 73-byte
 * trampoline that is byte-identical across every published release, and the native executable is
 * downloaded post-install into the package's own `node_modules/.bin_real`. Hashing the resolved
 * bin path therefore identifies nothing on that path -- it cannot tell 0.6.0 from 0.9.0. A
 * checkout points straight at the built executable, where that one hash is the whole identity.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** Files whose content decides where the executable comes from, and whether it is checked. */
export const RESOLVER_FILES = ["binary-install.js", "binary.js", "package.json", "run-warble.js"];

class WarbleIdentityError extends Error {}

function hashTree(root, onSymlink) {
  const digest = createHash("sha256");
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) onSymlink(candidate);
      else if (entry.isDirectory()) visit(candidate);
      else if (entry.isFile()) { digest.update(path.relative(root, candidate)); digest.update("\0"); digest.update(readFileSync(candidate)); }
    }
  };
  visit(root);
  return digest.digest("hex");
}

/** The `@warble/cli` package that owns `binary`, or undefined when it is not a package install. */
export function warbleCliPackageRoot(binary) {
  let directory = path.dirname(binary);
  for (;;) {
    const manifest = path.join(directory, "package.json");
    if (existsSync(manifest)) {
      try { if (JSON.parse(readFileSync(manifest, "utf8")).name === "@warble/cli") return directory; }
      catch { /* unreadable manifest: treat as not the package path */ }
      return undefined;
    }
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function lockfileIntegrity(repoRoot, version) {
  const lockfile = path.join(repoRoot, "pnpm-lock.yaml");
  if (!existsSync(lockfile)) throw new WarbleIdentityError("pnpm-lock.yaml not found: the installed Warble package cannot be identified");
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = readFileSync(lockfile, "utf8").match(new RegExp(`^  '@warble/cli@${escaped}':\\s*\\n\\s*resolution: \\{integrity: (sha512-[^}]+)\\}`, "m"));
  if (!match) throw new WarbleIdentityError(`pnpm-lock.yaml has no integrity entry for @warble/cli@${version}`);
  return match[1];
}

/**
 * Identity of the Warble reached through `binary`, as the attestation records it.
 *
 * Covers, on the package path: which release (`version`), which published package bytes
 * (`integrity`), the in-package resolution logic (`resolverSha256`), and what actually executes
 * (`extractedTreeSha256`). Does NOT cover package provenance, nor anything fetched at runtime from
 * outside the package -- notably the Hub archive, which is downloaded on first compile and cached
 * elsewhere.
 */
export function warbleIdentity(binary, repoRoot, onSymlink) {
  const packageRoot = warbleCliPackageRoot(binary);
  if (packageRoot === undefined) {
    return { resolution: "checkout", binarySha256: createHash("sha256").update(readFileSync(binary)).digest("hex") };
  }
  const version = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")).version;
  if (typeof version !== "string" || version.length === 0) throw new WarbleIdentityError("@warble/cli package.json declares no version");
  const extracted = path.join(packageRoot, "node_modules", ".bin_real");
  if (!existsSync(extracted)) throw new WarbleIdentityError("@warble/cli has no extracted executable: the package was never installed");
  const digest = createHash("sha256");
  for (const name of RESOLVER_FILES) {
    const resolverFile = path.join(packageRoot, name);
    if (!existsSync(resolverFile)) throw new WarbleIdentityError(`the installed @warble/cli is missing ${name}`);
    digest.update(name); digest.update("\0"); digest.update(readFileSync(resolverFile));
  }
  return {
    resolution: "package",
    version,
    integrity: lockfileIntegrity(repoRoot, version),
    resolverSha256: digest.digest("hex"),
    // ~12MB, measured at 8ms: no reason to leave what actually runs uncovered.
    extractedTreeSha256: hashTree(extracted, onSymlink),
  };
}

/**
 * True when two identity records name the same Warble in the same way.
 *
 * Requires the exact key set, not merely agreement on the keys this function knows about: an
 * attestation carrying an unrecognised field is one this build does not understand, and a gate
 * whose whole purpose is exactness should refuse it rather than compare the subset it recognises.
 */
export function sameWarbleIdentity(left, right) {
  if (!left || !right || left.resolution !== right.resolution) return false;
  const keys = left.resolution === "package"
    ? ["resolution", "version", "integrity", "resolverSha256", "extractedTreeSha256"]
    : ["resolution", "binarySha256"];
  const exact = (value) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
  if (!exact(left) || !exact(right)) return false;
  return keys.every((key) => typeof left[key] === "string" && left[key] === right[key]);
}
