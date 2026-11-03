import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "scripts",
  "check-size.mjs",
);
const MIB = 1024 * 1024;

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTmpDir(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function runGate(args, env = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function makeFixture(bytes) {
  const file = path.join(makeTmpDir("check-size-"), "fixture.wasm");
  writeFileSync(file, Buffer.alloc(bytes, 0xab));
  return file;
}

// A fake gzip on PATH that exits with the given code, to exercise the
// "executable runs but fails" branch.
function makeFakeGzipDir(exitCode) {
  const dir = makeTmpDir("fake-gzip-");
  const fake = path.join(dir, "gzip");
  writeFileSync(fake, `#!/bin/sh\nexit ${exitCode}\n`);
  chmodSync(fake, 0o755);
  return dir;
}

// The gate's own measurement: file-argument form, same file path — so the
// at-limit/over-limit boundary tests are byte-exact against the gate.
function gzipBytesOf(file) {
  const out = spawnSync("gzip", ["-c", "--", file], { maxBuffer: 64 * MIB });
  assert.equal(out.status, 0, "test helper: system gzip must be available");
  return out.stdout.length;
}

test("passes when the artifact is below the limit", () => {
  const file = makeFixture(1024);
  const res = runGate([file]);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /limit 15 MiB gzip/);
});

test("passes when the artifact is exactly at the limit", () => {
  const file = makeFixture(256 * 1024);
  const limitMib = gzipBytesOf(file) / MIB;
  const res = runGate([file], { MAX_GZIP_MIB: String(limitMib) });
  assert.equal(res.status, 0);
});

test("fails when the artifact exceeds the limit", () => {
  const file = makeFixture(256 * 1024);
  const limitMib = (gzipBytesOf(file) - 1) / MIB;
  const res = runGate([file], { MAX_GZIP_MIB: String(limitMib) });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /exceeds/);
});

test("reports the exact gzip byte count", () => {
  const file = makeFixture(256 * 1024);
  const res = runGate([file]);
  assert.equal(res.status, 0);
  assert.match(res.stdout, new RegExp(`\\(${gzipBytesOf(file)} bytes gzip`));
});

test("fails when the artifact is missing", () => {
  const missing = path.join(makeTmpDir("check-size-missing-"), "missing.wasm");
  const res = runGate([missing]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Cannot read WASM artifact/);
});

test("fails closed on an invalid limit", () => {
  const file = makeFixture(1024);
  for (const bad of ["abc", "NaN", "-1", "Infinity"]) {
    const res = runGate([file], { MAX_GZIP_MIB: bad });
    assert.equal(res.status, 1, `MAX_GZIP_MIB=${bad} must fail closed`);
    assert.match(res.stderr, /Invalid MAX_GZIP_MIB/);
  }
});

test("empty MAX_GZIP_MIB falls back to the default limit", () => {
  const file = makeFixture(1024);
  const res = runGate([file], { MAX_GZIP_MIB: "" });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /limit 15 MiB gzip/);
});

test("fails when the gzip executable is unavailable", () => {
  const file = makeFixture(1024);
  const res = runGate([file], { PATH: "" });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /Failed to run system gzip/);
});

test("fails when gzip exits non-zero", () => {
  const file = makeFixture(1024);
  const res = runGate([file], { PATH: makeFakeGzipDir(3) });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /gzip exited with status 3/);
});
