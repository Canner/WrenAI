import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { approvedManifest, refetchExactPublishAssets, validateRuntimeTag, verifyExactPublishInventory } from "./managed-wren-release.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const python = "cpython-3.11.16+fixture-aarch64-apple-darwin-install_only.tar.gz";
const wheel = "wrenai-0.13.0-py3-none-any.whl";
const clone = (value) => JSON.parse(JSON.stringify(value));

function fixture() {
  const source = "https://files.pythonhosted.org/packages/fixture/";
  const mirror = "https://github.com/Canner/WrenAI/releases/download/managed-wren-fixture/";
  const sources = new Map([[source + python, "python fixture"], [source + wheel, "wheel fixture"]]);
  const wheels = [{ distribution: "wrenai", version: "0.13.0", filename: wheel, sourceUrl: source + wheel, sha256: hash("wheel fixture"), url: mirror + wheel }];
  return {
    candidate: { activation: "staged", platform: "darwin-arm64", compatibility: { wren: "0.13.0" }, python: { upstream: { url: source + python, sha256: hash("python fixture") }, mirror: { url: mirror + python, sha256: hash("python fixture") } }, wheels },
    inputs: wheels.map(({ url, ...input }) => ({ ...input, license: "Apache-2.0" })),
    sources,
  };
}
async function temp(t) {
  const root = await mkdtemp(path.join(tmpdir(), "managed-wren-contract-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("exact inventory refetches only approved fixture bytes; approval does not mutate the candidate", async (t) => {
  const { candidate, inputs, sources } = fixture();
  const root = await temp(t);
  const fetched = [];
  await refetchExactPublishAssets(candidate, inputs, root, async (url) => {
    fetched.push(url);
    assert.ok(sources.has(url));
    return new Response(sources.get(url));
  });
  assert.deepEqual(fetched, [...sources.keys()]);
  assert.equal(await readFile(path.join(root, wheel), "utf8"), "wheel fixture");
  assert.equal(approvedManifest(candidate).activation, "approved");
  assert.equal(candidate.activation, "staged");
});

test("rejects changed hashes, incomplete/extra/duplicate inventories and altered source/mirror identity", () => {
  const value = fixture();
  for (const mutate of [
    (c) => { c.wheels[0].sha256 = "f".repeat(64); },
    (c, i) => { i.length = 0; },
    (c, i) => { i.push({ ...i[0], filename: "extra-1.0.whl" }); },
    (c, i) => { c.wheels.push(clone(c.wheels[0])); i.push(clone(i[0])); },
    (c) => { c.wheels[0].sourceUrl += "?changed"; },
    (c) => { c.wheels[0].url = c.wheels[0].url.replace("managed-wren-fixture", "other"); },
    (c) => { c.python.upstream.sha256 = "f".repeat(64); },
    (c) => { c.python.mirror.url += ".other"; },
    (c) => { c.activation = "approved"; },
    (c) => { c.platform = "linux-x64"; },
  ]) {
    const candidate = clone(value.candidate); const inputs = clone(value.inputs);
    mutate(candidate, inputs);
    assert.throws(() => verifyExactPublishInventory(candidate, inputs));
  }
});

test("invalid inventory fails before any fetch or asset-directory creation", async (t) => {
  const { candidate, inputs } = fixture();
  const root = await temp(t); const assets = path.join(root, "assets");
  inputs[0].sha256 = "e".repeat(64);
  await assert.rejects(refetchExactPublishAssets(candidate, inputs, assets, () => assert.fail("must not fetch")));
  assert.deepEqual(await readdir(root), []);
});

test("changed source bytes or failed HTTP cannot produce an approved asset", async (t) => {
  const { candidate, inputs } = fixture();
  const root = await temp(t);
  for (const [name, response] of [["corrupt", new Response("corrupt")], ["missing", new Response("", { status: 404 })]]) {
    const assets = path.join(root, name);
    await assert.rejects(refetchExactPublishAssets(candidate, inputs, assets, async () => response));
    assert.deepEqual(await readdir(assets), []);
  }
});

test("release tags are namespace-bound and cannot inject shell syntax, options or invalid git refs", () => {
  assert.equal(validateRuntimeTag("managed-wren-v0.0.4"), "managed-wren-v0.0.4");
  for (const tag of ["", "v0.0.4", "--help", "managed-wren-", "managed-wren-a..b", "managed-wren-a.lock", "managed-wren-a.", "managed-wren-a/b", 'managed-wren-"; exit 0; #', "managed-wren-$(touch bad)", "managed-wren-a\nb", "managed-wren-" + "a".repeat(102)]) {
    assert.throws(() => validateRuntimeTag(tag));
    assert.notEqual(spawnSync(process.execPath, [path.join(here, "managed-wren-release.mjs"), "validate-tag", tag]).status, 0);
  }
  execFileSync(process.execPath, [path.join(here, "managed-wren-release.mjs"), "validate-tag", "managed-wren-v0.0.4"]);
});

test("workflow is manual-only, data-binds user input and exposes no raw pre-approval assets", async () => {
  const workflow = await readFile(path.join(repo, ".github/workflows/managed-wren-runtime.yml"), "utf8");
  assert.match(workflow, /on:\n  workflow_dispatch:/);
  assert.doesNotMatch(workflow, /(?:pull_request|push):/);
  assert.match(workflow, /group: managed-wren-\$\{\{ inputs.runtime_tag \}\}/);
  assert.match(workflow, /cancel-in-progress: false/);
  for (const line of workflow.split("\n").filter((line) => line.includes("${{ inputs.runtime_tag }}"))) {
    assert.match(line.trim(), /^(RUNTIME_TAG:|group:)/);
  }
  const [stage, publish] = workflow.split("  publish-approved-runtime:");
  assert.match(stage, /permissions:\n  contents: read/);
  assert.match(stage, /path: release\/\*\.json/);
  assert.doesNotMatch(stage, /GH_TOKEN|contents: write|gh release/);
  assert.ok(stage.indexOf('validate-tag "$RUNTIME_TAG"') < stage.indexOf("pip download"));
  assert.match(publish, /needs: stage/);
  assert.match(publish, /environment: managed-wren-license-approved/);
  assert.match(publish, /secrets.MANAGED_WREN_APPROVAL_SHA256/);
  assert.match(publish, /gh release create "\$RUNTIME_TAG" --target "\$GITHUB_SHA" --latest=false/);
  assert.ok(publish.indexOf('test -n "$APPROVAL_DIGEST"') < publish.indexOf("verify-publish"));
  assert.ok(publish.indexOf("verify-publish") < publish.indexOf("GH_TOKEN:"));
});

test("actual workflow approval commands reject missing or stale approval and bind all three review files", async (t) => {
  const root = await temp(t);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.join(root, "release"));
  const names = ["managed-wren-manifest.candidate.json", "pbs-license-inventory.json", "wheel-license-inventory.json"];
  const bytes = names.map((name) => JSON.stringify({ fixture: name }) + "\n");
  for (let i = 0; i < names.length; i++) await writeFile(path.join(root, "release", names[i]), bytes[i]);
  const workflow = await readFile(path.join(repo, ".github/workflows/managed-wren-runtime.yml"), "utf8");
  const lines = workflow.split("\n").filter((line) => line.trimStart().startsWith('test ') && line.includes("$APPROVAL_DIGEST"));
  assert.equal(lines.length, 2);
  const command = "set -e\n" + lines.map((line) => line.trim()).join("\n");
  const run = (approval) => spawnSync("/bin/sh", ["-c", command], { cwd: root, env: { PATH: process.env.PATH, APPROVAL_DIGEST: approval } });
  assert.notEqual(run("").status, 0);
  assert.notEqual(run("f".repeat(64)).status, 0);
  const approval = hash(bytes.join(""));
  assert.equal(run(approval).status, 0);
  for (let i = 0; i < names.length; i++) {
    await writeFile(path.join(root, "release", names[i]), "changed");
    assert.notEqual(run(approval).status, 0);
    await writeFile(path.join(root, "release", names[i]), bytes[i]);
  }
});
