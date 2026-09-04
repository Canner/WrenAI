import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [packageDir, version, sourceCommit, archivePath, assetUrl] = process.argv.slice(2);
if (![packageDir, version, sourceCommit, archivePath, assetUrl].every(Boolean)) {
  throw new Error("usage: generate-release-manifest.mjs <package-dir> <version> <source-commit> <archive> <asset-url>");
}
const archive = await readFile(archivePath);
const binaryPath = "wren-context-loader";
const binary = await readBinaryFromTarGz(archive, binaryPath);
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const manifest = {
  schema: 1,
  package: "@wrenai/context-loader",
  version,
  sourceCommit,
  artifacts: {
    "darwin-arm64": { url: assetUrl, archiveSha256: sha256(archive), binarySha256: sha256(binary), binaryPath },
  },
};
await writeFile(path.join(packageDir, "artifacts.json"), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(manifest)}\n`);

async function readBinaryFromTarGz(archive, expectedPath) {
  const { gunzipSync } = await import("node:zlib");
  const tar = gunzipSync(archive);
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/u, "");
    const size = Number.parseInt(header.subarray(124, 136).toString("utf8").replace(/\0.*$/u, "").trim() || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) throw new Error("invalid release archive layout");
    if (name === expectedPath) return tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`release archive lacks ${expectedPath}`);
}
