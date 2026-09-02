import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
// @ts-expect-error -- plain .mjs module shared with the gate scripts
import { warbleIdentity, sameWarbleIdentity, RESOLVER_FILES } from "../scripts/warble-identity.mjs";

const INTEGRITY = "sha512-KWIE5Ax/VzyJNxOFnuaHlu7imx5uhU9WU+S5iEmIv1F8jrbGq2aDFxKuNsujCZqFy+v1gPWa9PNGOXCQwC6edg==";

/**
 * A stand-in for an installed `@warble/cli`: the trampoline, the resolution logic beside it, and
 * the executable those download into the package's own node_modules/.bin_real.
 */
function packageInstall(overrides: { version?: string; resolver?: string; executable?: string } = {}) {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "warble-identity-"));
  const packageRoot = path.join(repoRoot, "node_modules", "@warble", "cli");
  mkdirSync(packageRoot, { recursive: true });
  const version = overrides.version ?? "0.9.0";
  writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ name: "@warble/cli", version, bin: { warble: "run-warble.js" } }));
  writeFileSync(path.join(packageRoot, "run-warble.js"), '#!/usr/bin/env node\nrequire("./binary").run("warble");\n');
  writeFileSync(path.join(packageRoot, "binary.js"), "module.exports = {};\n");
  writeFileSync(path.join(packageRoot, "binary-install.js"), overrides.resolver ?? "// verifies the download\n");
  const extracted = path.join(packageRoot, "node_modules", ".bin_real");
  mkdirSync(extracted, { recursive: true });
  writeFileSync(path.join(extracted, "warble"), overrides.executable ?? "the real executable\n");
  writeFileSync(path.join(repoRoot, "pnpm-lock.yaml"), `packages:\n\n  '@warble/cli@${version}':\n    resolution: {integrity: ${INTEGRITY}}\n    hasBin: true\n`);
  return { repoRoot, bin: path.join(packageRoot, "run-warble.js") };
}

const identify = (install: { repoRoot: string; bin: string }) =>
  warbleIdentity(install.bin, install.repoRoot, () => { throw new Error("unexpected symlink"); });

describe("warble identity", () => {
  it("names a package install by version, integrity, resolver and what was extracted", () => {
    const identity = identify(packageInstall());
    expect(identity).toEqual({
      resolution: "package",
      version: "0.9.0",
      integrity: INTEGRITY,
      resolverSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      extractedTreeSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  // The defect this replaces: every published @warble/cli ships a byte-identical trampoline, so
  // hashing the resolved bin path produced the same value for every release. Two installs that
  // differ only in which Warble they are must not be given the same identity.
  it("distinguishes two releases whose trampolines are byte-identical", () => {
    const older = identify(packageInstall({ version: "0.8.0" }));
    const newer = identify(packageInstall({ version: "0.9.0" }));
    expect(older.version).not.toBe(newer.version);
    expect(sameWarbleIdentity(older, newer)).toBe(false);
  });

  it("changes when the extracted executable is swapped and the trampoline is not", () => {
    const attested = identify(packageInstall());
    const swapped = identify(packageInstall({ executable: "#!/bin/sh\necho IMPOSTOR\n" }));
    expect(swapped.extractedTreeSha256).not.toBe(attested.extractedTreeSha256);
    expect(sameWarbleIdentity(attested, swapped)).toBe(false);
  });

  it("changes when the logic that fetches and checks the download is edited", () => {
    const attested = identify(packageInstall());
    const neutered = identify(packageInstall({ resolver: "// checksum check removed\n" }));
    expect(neutered.resolverSha256).not.toBe(attested.resolverSha256);
    expect(sameWarbleIdentity(attested, neutered)).toBe(false);
  });

  it("covers every file that decides where the executable comes from", () => {
    expect([...RESOLVER_FILES].sort()).toEqual(["binary-install.js", "binary.js", "package.json", "run-warble.js"]);
  });

  it("refuses an install the lockfile cannot account for", () => {
    const install = packageInstall();
    writeFileSync(path.join(install.repoRoot, "pnpm-lock.yaml"), "packages:\n");
    expect(() => identify(install)).toThrow(/no integrity entry for @warble\/cli@0\.9\.0/);
  });

  // An attestation carrying a field this build does not know about is not a match on the subset
  // it happens to recognise: the gate exists to be exact, so an unrecognised shape fails closed.
  it("refuses an identity that carries an unrecognised field", () => {
    const identity = identify(packageInstall());
    expect(sameWarbleIdentity(identity, { ...identity, somethingNewer: "x" })).toBe(false);
    expect(sameWarbleIdentity(identity, identity)).toBe(true);
  });

  it("names a checkout binary by its own content, unchanged", () => {
    const root = mkdtempSync(path.join(tmpdir(), "warble-checkout-"));
    const bin = path.join(root, "warble");
    writeFileSync(bin, "built from a checkout\n");
    expect(warbleIdentity(bin, root, () => {})).toEqual({ resolution: "checkout", binarySha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });
});
