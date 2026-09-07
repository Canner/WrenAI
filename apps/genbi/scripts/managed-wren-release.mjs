#!/usr/bin/env node
/** Generate and verify exact managed-Wren release evidence; it never publishes. */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const fileDigest = async (target) => digest(await readFile(target));
const stableJson = (value) => Array.isArray(value) ? "[" + value.map(stableJson).join(",") + "]" : value && typeof value === "object" ? "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stableJson(value[key])).join(",") + "}" : JSON.stringify(value);
const filenameFromUrl = (url) => decodeURIComponent(new URL(url).pathname.split("/").at(-1) ?? "");
const exactName = (value) => /^[A-Za-z0-9._+%-]+$/.test(value);
const exactHash = (value) => /^[a-f0-9]{64}$/.test(value);
const treeDigest = async (root) => {
  const entries = [];
  const visit = async (directory) => {
    for (const name of (await readdir(directory)).sort()) {
      if (name === "__pycache__") continue;
      const target = path.join(directory, name); const metadata = await stat(target);
      if (metadata.isDirectory()) await visit(target); else if (metadata.isFile()) entries.push(path.relative(root, target) + "\0" + await fileDigest(target)); else throw new Error("unsupported runtime entry: " + target);
    }
  };
  await visit(root); return digest(entries.join("\n"));
};

/** The protected job consumes this exact inventory; it never resolves PyPI. */
export function verifyExactPublishInventory(candidate, wheelInputs) {
  if (!candidate || candidate.activation !== "staged" || candidate.platform !== "darwin-arm64") throw new Error("invalid candidate manifest");
  if (!candidate.python || !/^https:/.test(candidate.python.upstream?.url) || !/^https:\/\/github\.com\/Canner\/WrenAI\/releases\/download\//.test(candidate.python.mirror?.url) || !exactHash(candidate.python.mirror?.sha256) || candidate.python.mirror.sha256 !== candidate.python.upstream?.sha256) throw new Error("invalid exact Python candidate");
  const pythonFilename = filenameFromUrl(candidate.python.upstream.url);
  if (!exactName(pythonFilename) || filenameFromUrl(candidate.python.mirror.url) !== pythonFilename) throw new Error("Python mirror filename differs from approved source");
  if (!Array.isArray(candidate.wheels) || !Array.isArray(wheelInputs) || candidate.wheels.length === 0) throw new Error("missing wheel closure");
  const mirrorRoot = candidate.python.mirror.url.slice(0, -pythonFilename.length);
  const seen = new Set(); const inventory = new Map();
  for (const wheel of wheelInputs) {
    if (!wheel || !exactName(wheel.filename) || !exactHash(wheel.sha256) || !/^https:/.test(wheel.sourceUrl) || !/^[a-z0-9][a-z0-9._-]*$/.test(wheel.distribution) || !/^[A-Za-z0-9!+._-]+$/.test(wheel.version) || seen.has(wheel.filename)) throw new Error("invalid or duplicate selected wheel inventory");
    seen.add(wheel.filename); inventory.set(wheel.filename, wheel);
  }
  if (inventory.size !== candidate.wheels.length) throw new Error("wheel closure has extra or missing artifacts");
  const selected = [];
  for (const wheel of candidate.wheels) {
    const input = inventory.get(wheel.filename);
    if (!input || wheel.distribution !== input.distribution || wheel.version !== input.version || wheel.sha256 !== input.sha256 || wheel.sourceUrl !== input.sourceUrl || wheel.url !== mirrorRoot + wheel.filename || filenameFromUrl(wheel.sourceUrl) !== wheel.filename) throw new Error("wheel candidate does not exactly match selected inventory");
    selected.push(wheel);
  }
  if (candidate.wheels[0]?.distribution !== "wrenai" || candidate.wheels[0]?.version !== candidate.compatibility?.wren) throw new Error("candidate does not pin wrenai first");
  return Object.freeze({ python: Object.freeze({ url: candidate.python.upstream.url, filename: pythonFilename, sha256: candidate.python.upstream.sha256 }), wheels: Object.freeze(selected.map((wheel) => Object.freeze({ url: wheel.sourceUrl, filename: wheel.filename, sha256: wheel.sha256 }))) });
}

export async function refetchExactPublishAssets(candidate, wheelInputs, assetsDirectory, fetchImpl = fetch) {
  const approved = verifyExactPublishInventory(candidate, wheelInputs);
  await mkdir(assetsDirectory, { recursive: true, mode: 0o700 });
  for (const artifact of [approved.python, ...approved.wheels]) {
    const response = await fetchImpl(artifact.url); if (!response.ok) throw new Error("approved source fetch failed");
    const bytes = Buffer.from(await response.arrayBuffer()); if (digest(bytes) !== artifact.sha256) throw new Error("approved source hash changed");
    await writeFile(path.join(assetsDirectory, artifact.filename), bytes, { mode: 0o600, flag: "wx" });
  }
  return approved;
}

export function approvedManifest(candidate) {
  verifyExactPublishInventory(candidate, candidate.wheels);
  return { ...candidate, activation: "approved", licenseApproval: { state: "approved", evidence: "protected-environment-digest" } };
}

async function generate(output, runtimeTag) {
  if (!output || !runtimeTag || !/^[A-Za-z0-9._-]+$/.test(runtimeTag)) throw new Error("usage: managed-wren-release.mjs <output-directory> <runtime-tag>");
  const inputs = JSON.parse(await readFile(path.join(packageRoot, "managed-wren", "release-inputs.json"), "utf8"));
  for (const artifact of [inputs.python, inputs.wrenai]) if (!artifact || !/^https:/.test(artifact.url) || !exactHash(artifact.sha256) || !exactName(artifact.filename)) throw new Error("invalid exact release input");
  const wheelInputs = JSON.parse(await readFile(path.join(output, "wheel-inputs.json"), "utf8"));
  if (!Array.isArray(wheelInputs) || wheelInputs.length === 0) throw new Error("missing selected wheel closure");
  const wheelLicenses = new Map(wheelInputs.map((wheel) => [wheel.filename, wheel.license]));
  const wheels = wheelInputs.map((wheel) => {
    if (!wheel || !/^[a-z0-9][a-z0-9._-]*$/.test(wheel.distribution) || !/^[A-Za-z0-9!+._-]+$/.test(wheel.version) || !exactName(wheel.filename) || !/^https:/.test(wheel.sourceUrl) || filenameFromUrl(wheel.sourceUrl) !== wheel.filename || !exactHash(wheel.sha256)) throw new Error("invalid selected wheel closure");
    return { distribution: wheel.distribution, version: wheel.version, filename: wheel.filename, sourceUrl: wheel.sourceUrl, sha256: wheel.sha256, url: "https://github.com/Canner/WrenAI/releases/download/" + runtimeTag + "/" + wheel.filename };
  }).sort((a, b) => a.filename.localeCompare(b.filename));
  const rootInput = wheelInputs.find((wheel) => wheel.distribution === "wrenai");
  if (!rootInput || rootInput.version !== inputs.wrenai.version || rootInput.filename !== inputs.wrenai.filename || rootInput.sourceUrl !== inputs.wrenai.url || rootInput.sha256 !== inputs.wrenai.sha256) throw new Error("selected wrenai wheel differs from exact release input");
  const wrenIndex = wheels.findIndex((wheel) => wheel.distribution === "wrenai" && wheel.version === inputs.wrenai.version);
  if (wrenIndex < 0) throw new Error("wrenai is absent from the selected wheel closure");
  const [wrenai] = wheels.splice(wrenIndex, 1); wheels.unshift(wrenai);
  const sitePackagesPath = path.join(output, "runtime", "venv", "lib", "python3.11", "site-packages");
  const packageTreeSha256 = await treeDigest(path.join(sitePackagesPath, "wren")); const sitePackagesTreeSha256 = await treeDigest(sitePackagesPath);
  const closureSha256 = digest(wheels.map((wheel) => wheel.filename + "\0" + wheel.sha256).sort().join("\n"));
  const manifest = { schema: 1, activation: "staged", platform: "darwin-arm64", compatibility: { genbi: inputs.compatibility.genbi, profile: inputs.compatibility.profile, wren: inputs.wrenai.version }, python: { implementation: "cpython", version: inputs.python.version, upstream: { release: inputs.python.release, url: inputs.python.url, sha256: inputs.python.sha256 }, mirror: { url: "https://github.com/Canner/WrenAI/releases/download/" + runtimeTag + "/" + inputs.python.filename, sha256: inputs.python.sha256 }, interpreterPath: "python/bin/python3.11" }, wheels, runtime: { pythonArchivePath: "python.tar.gz", venvInterpreterPath: "venv/bin/python", launcherPath: "venv/bin/wren", module: "wren.cli:app", packagePath: "venv/lib/python3.11/site-packages/wren", sitePackagesPath: "venv/lib/python3.11/site-packages", packageTreeSha256, sitePackagesTreeSha256, closureSha256 }, licenseApproval: { state: "pending" } };
  verifyExactPublishInventory(manifest, wheelInputs);
  const inventory = { schema: 1, status: "pending-explicit-approval", components: [{ name: "python-build-standalone", version: "cpython-" + inputs.python.release, declaredLicense: "MPL-2.0", artifact: inputs.python.filename }, { name: "CPython", version: inputs.python.version, declaredLicense: "PSF-2.0", artifact: inputs.python.filename }, ...wheels.map((wheel) => ({ name: wheel.distribution, version: wheel.version, declaredLicense: wheelLicenses.get(wheel.filename) ?? "UNKNOWN", artifact: wheel.filename }))], note: "The protected release environment must approve the completed expanded wheel and bundled-library inventory before public assets or an approved manifest can be emitted." };
  const provenance = { schema: 1, inputs, selectedWheels: wheelInputs, stagedManifestSha256: digest(stableJson(manifest)), generatedAt: new Date().toISOString() };
  await mkdir(output, { recursive: true, mode: 0o700 });
  await writeFile(path.join(output, "managed-wren-manifest.candidate.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
  await writeFile(path.join(output, "license-inventory.json"), JSON.stringify(inventory, null, 2) + "\n", { mode: 0o600 });
  await writeFile(path.join(output, "provenance.json"), JSON.stringify(provenance, null, 2) + "\n", { mode: 0o600 });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "verify-publish") {
    const [reviewDirectory, assetsDirectory] = args; if (!reviewDirectory || !assetsDirectory) throw new Error("usage: managed-wren-release.mjs verify-publish <review-directory> <assets-directory>");
    const candidate = JSON.parse(await readFile(path.join(reviewDirectory, "managed-wren-manifest.candidate.json"), "utf8"));
    const wheelInputs = JSON.parse(await readFile(path.join(reviewDirectory, "wheel-inputs.json"), "utf8"));
    await refetchExactPublishAssets(candidate, wheelInputs, assetsDirectory);
    await writeFile(path.join(reviewDirectory, "managed-wren-manifest.json"), JSON.stringify(approvedManifest(candidate), null, 2) + "\n", { mode: 0o600 });
    return;
  }
  await generate(command, args[0]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
