import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { installContextLoader, isRepositorySourcePackage } from "../scripts/installer.mjs";
import { readVerifiedState } from "../lib/verified.mjs";

const sha256 = (content) => createHash("sha256").update(content).digest("hex");

function tarEntry(name, content) {
  const header = Buffer.alloc(512);
  header.write(name);
  header.write(content.length.toString(8).padStart(11, "0"), 124);
  header[135] = 0;
  header[156] = "0".charCodeAt(0);
  header.write("ustar", 257);
  return Buffer.concat([header, content, Buffer.alloc((512 - (content.length % 512)) % 512), Buffer.alloc(1024)]);
}

async function fixture({ artifact = Buffer.from("#!/bin/sh\necho loader\n"), target = "darwin-arm64", row = {} } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "context-loader-package-"));
  const archive = gzipSync(tarEntry("wren-context-loader", artifact));
  const manifest = {
    schema: 1,
    package: "@wrenai/context-loader",
    version: "0.1.0",
    artifacts: {
      [target]: {
        url: "https://example.invalid/context-loader.tar.gz",
        archiveSha256: sha256(archive),
        binarySha256: sha256(artifact),
        binaryPath: "wren-context-loader",
        ...row,
      },
    },
  };
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: manifest.package, version: manifest.version }));
  await writeFile(path.join(root, "artifacts.json"), JSON.stringify(manifest));
  return { root, archive, artifact };
}

const fetchArchive = (archive) => async () => ({ ok: true, arrayBuffer: async () => archive });

test("installs a digest-verified darwin-arm64 binary atomically and records canonical state", async () => {
  const { root, archive, artifact } = await fixture();
  const first = await installContextLoader({ packageRoot: root, fetchImpl: fetchArchive(archive), platform: "darwin", arch: "arm64" });
  assert.equal(first.reused, false);
  assert.deepEqual(await readFile(first.binary), artifact);
  const state = readVerifiedState(root);
  assert.equal(state.binary, await realpath(first.binary));
  assert.match(state.identity, /package:@wrenai\/context-loader@0\.1\.0:darwin-arm64:[a-f0-9]{64}/);
  const second = await installContextLoader({ packageRoot: root, fetchImpl: async () => { throw new Error("offline"); }, platform: "darwin", arch: "arm64" });
  assert.equal(second.reused, true);
});

test("fails closed for unsupported targets, archive tampering, and binary digest tampering", async () => {
  const supported = await fixture();
  await assert.rejects(
    installContextLoader({ packageRoot: supported.root, fetchImpl: fetchArchive(supported.archive), platform: "linux", arch: "x64" }),
    /unsupported-platform/,
  );
  const archiveTampered = await fixture({ row: { archiveSha256: "0".repeat(64) } });
  await assert.rejects(installContextLoader({ packageRoot: archiveTampered.root, fetchImpl: fetchArchive(archiveTampered.archive), platform: "darwin", arch: "arm64" }), /archive-digest-mismatch/);
  const binaryTampered = await fixture({ row: { binarySha256: "0".repeat(64) } });
  await assert.rejects(installContextLoader({ packageRoot: binaryTampered.root, fetchImpl: fetchArchive(binaryTampered.archive), platform: "darwin", arch: "arm64" }), /binary-digest-mismatch/);
});

test("rejects stale or altered installed state at runtime", async () => {
  const { root, archive } = await fixture();
  await installContextLoader({ packageRoot: root, fetchImpl: fetchArchive(archive), platform: "darwin", arch: "arm64" });
  const statePath = path.join(root, "install-state.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  await writeFile(statePath, JSON.stringify({ ...state, version: "0.1.1" }));
  assert.throws(() => readVerifiedState(root), /stale-state/);
});

test("rejects final-file and ancestor-directory symlinks at runtime", async () => {
  const finalLink = await fixture();
  const installed = await installContextLoader({ packageRoot: finalLink.root, fetchImpl: fetchArchive(finalLink.archive), platform: "darwin", arch: "arm64" });
  const external = path.join(await mkdtemp(path.join(os.tmpdir(), "context-loader-external-")), "wren-context-loader");
  await writeFile(external, await readFile(installed.binary), { mode: 0o755 });
  await rm(installed.binary);
  await symlink(external, installed.binary);
  assert.throws(() => readVerifiedState(finalLink.root), /linked|outside/);

  const ancestorLink = await fixture();
  const installedAncestor = await installContextLoader({ packageRoot: ancestorLink.root, fetchImpl: fetchArchive(ancestorLink.archive), platform: "darwin", arch: "arm64" });
  const externalDir = await mkdtemp(path.join(os.tmpdir(), "context-loader-external-dir-"));
  await writeFile(path.join(externalDir, "wren-context-loader"), await readFile(installedAncestor.binary), { mode: 0o755 });
  await rm(path.join(ancestorLink.root, "bin"), { recursive: true });
  await symlink(externalDir, path.join(ancestorLink.root, "bin"));
  assert.throws(() => readVerifiedState(ancestorLink.root), /linked|outside/);
});

test("refuses a same-bytes external binary during reuse and a bin-directory link before any install write", async () => {
  const reusable = await fixture();
  const installed = await installContextLoader({ packageRoot: reusable.root, fetchImpl: fetchArchive(reusable.archive), platform: "darwin", arch: "arm64" });
  const external = path.join(await mkdtemp(path.join(os.tmpdir(), "context-loader-reuse-external-")), "wren-context-loader");
  await writeFile(external, await readFile(installed.binary), { mode: 0o755 });
  await rm(installed.binary);
  await symlink(external, installed.binary);
  await assert.rejects(
    installContextLoader({ packageRoot: reusable.root, fetchImpl: fetchArchive(reusable.archive), platform: "darwin", arch: "arm64" }),
    /unsafe-path/,
  );
  assert.deepEqual(await readFile(external), reusable.artifact);

  const fresh = await fixture();
  const externalDir = await mkdtemp(path.join(os.tmpdir(), "context-loader-write-external-"));
  const sentinel = path.join(externalDir, "wren-context-loader");
  await writeFile(sentinel, "outside-before", { mode: 0o755 });
  await symlink(externalDir, path.join(fresh.root, "bin"));
  await assert.rejects(
    installContextLoader({ packageRoot: fresh.root, fetchImpl: fetchArchive(fresh.archive), platform: "darwin", arch: "arm64" }),
    /unsafe-path/,
  );
  assert.equal(await readFile(sentinel, "utf8"), "outside-before");
  assert.deepEqual(await readdir(externalDir), ["wren-context-loader"]);
});

test("skips only the tracked source checkout, never a lookalike git repository or packed copy", async () => {
  const sourcePackage = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  assert.equal(await isRepositorySourcePackage(sourcePackage), true);

  const fakeRoot = await mkdtemp(path.join(os.tmpdir(), "context-loader-fake-source-"));
  const fakePackage = path.join(fakeRoot, "apps", "context-loader");
  await mkdir(path.join(fakeRoot, "core", "wren"), { recursive: true });
  await mkdir(fakePackage, { recursive: true });
  await writeFile(path.join(fakePackage, "package.json"), "{}\n");
  await writeFile(path.join(fakeRoot, "pnpm-workspace.yaml"), "packages: []\n");
  await writeFile(path.join(fakeRoot, "core", "wren", "pyproject.toml"), "[project]\nname = \"wren\"\n");
  execFileSync("git", ["init", fakeRoot]);
  execFileSync("git", ["-C", fakeRoot, "add", "apps/context-loader/package.json", "pnpm-workspace.yaml", "core/wren/pyproject.toml"]);
  execFileSync("git", ["-C", fakeRoot, "remote", "add", "origin", "https://example.invalid/lookalike.git"]);
  assert.equal(await isRepositorySourcePackage(fakePackage), false);

  const packedCopy = path.join(fakeRoot, "node_modules", "@wrenai", "context-loader");
  await mkdir(packedCopy, { recursive: true });
  assert.equal(await isRepositorySourcePackage(packedCopy), false);
});
