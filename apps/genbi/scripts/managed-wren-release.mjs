#!/usr/bin/env node
/** Generate review-only managed-Wren release evidence; it never publishes. */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [output, runtimeTag] = process.argv.slice(2);
if (!output || !runtimeTag || !/^[A-Za-z0-9._-]+$/.test(runtimeTag)) throw new Error("usage: managed-wren-release.mjs <output-directory> <runtime-tag>");
const inputs = JSON.parse(await readFile(path.join(packageRoot, "managed-wren", "release-inputs.json"), "utf8"));
const digest = (value) => createHash("sha256").update(value).digest("hex");
const fileDigest = async (target) => digest(await readFile(target));
const stableJson = (value) => Array.isArray(value) ? "[" + value.map(stableJson).join(",") + "]" : value && typeof value === "object" ? "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stableJson(value[key])).join(",") + "}" : JSON.stringify(value);
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
for (const artifact of [inputs.python, inputs.wrenai]) {
  if (!artifact || !/^https:/.test(artifact.url) || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !/^[A-Za-z0-9._+%-]+$/.test(artifact.filename)) throw new Error("invalid exact release input");
}
const wheelInputs = JSON.parse(await readFile(path.join(output, "wheel-inputs.json"), "utf8"));
if (!Array.isArray(wheelInputs) || wheelInputs.length === 0) throw new Error("missing selected wheel closure");
const wheelLicenses = new Map(wheelInputs.map((wheel) => [wheel.filename, wheel.license]));
const wheels = wheelInputs.map((wheel) => {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(wheel.distribution) || !/^[A-Za-z0-9!+._-]+$/.test(wheel.version) || !/^[A-Za-z0-9._+%-]+$/.test(wheel.filename) || !/^https:/.test(wheel.sourceUrl) || !/^[a-f0-9]{64}$/.test(wheel.sha256)) throw new Error("invalid selected wheel closure");
  return { distribution: wheel.distribution, version: wheel.version, filename: wheel.filename, sourceUrl: wheel.sourceUrl, sha256: wheel.sha256, url: "https://github.com/Canner/WrenAI/releases/download/" + runtimeTag + "/" + wheel.filename };
}).sort((a, b) => a.filename.localeCompare(b.filename));
const wrenIndex = wheels.findIndex((wheel) => wheel.distribution === "wrenai" && wheel.version === inputs.wrenai.version);
if (wrenIndex < 0) throw new Error("wrenai is absent from the selected wheel closure");
const [wrenai] = wheels.splice(wrenIndex, 1); wheels.unshift(wrenai);
const packageTreeSha256 = await treeDigest(path.join(output, "runtime", "venv", "lib", "python3.11", "site-packages", "wren"));
const closureSha256 = digest(wheels.map((wheel) => wheel.filename + "\0" + wheel.sha256).sort().join("\n"));
const manifest = {
  schema: 1, activation: "staged", platform: "darwin-arm64",
  compatibility: { genbi: inputs.compatibility.genbi, profile: inputs.compatibility.profile, wren: inputs.wrenai.version },
  python: { implementation: "cpython", version: inputs.python.version, upstream: { release: inputs.python.release, url: inputs.python.url, sha256: inputs.python.sha256 }, mirror: { url: "https://github.com/Canner/WrenAI/releases/download/" + runtimeTag + "/" + inputs.python.filename, sha256: inputs.python.sha256 }, interpreterPath: "python/install/bin/python3.11" },
  wheels,
  runtime: { pythonArchivePath: "python.tar.gz", venvInterpreterPath: "venv/bin/python", launcherPath: "venv/bin/wren", module: "wren.cli:app", packagePath: "venv/lib/python3.11/site-packages/wren", packageTreeSha256, closureSha256 },
  licenseApproval: { state: "pending" },
};
const inventory = { schema: 1, status: "pending-explicit-approval", components: [{ name: "python-build-standalone", version: "cpython-" + inputs.python.release, declaredLicense: "MPL-2.0", artifact: inputs.python.filename }, { name: "CPython", version: inputs.python.version, declaredLicense: "PSF-2.0", artifact: inputs.python.filename }, ...wheels.map((wheel) => ({ name: wheel.distribution, version: wheel.version, declaredLicense: wheelLicenses.get(wheel.filename) ?? "UNKNOWN", artifact: wheel.filename }))], note: "The protected release environment must approve the completed expanded wheel and bundled-library inventory before public assets or an approved manifest can be emitted." };
const provenance = { schema: 1, inputs, selectedWheels: wheels, stagedManifestSha256: digest(stableJson(manifest)), generatedAt: new Date().toISOString() };
await mkdir(output, { recursive: true, mode: 0o700 });
await writeFile(path.join(output, "managed-wren-manifest.candidate.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
await writeFile(path.join(output, "license-inventory.json"), JSON.stringify(inventory, null, 2) + "\n", { mode: 0o600 });
await writeFile(path.join(output, "provenance.json"), JSON.stringify(provenance, null, 2) + "\n", { mode: 0o600 });
