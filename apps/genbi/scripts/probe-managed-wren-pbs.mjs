#!/usr/bin/env node
/** Non-publishing reproducibility probe for the exact managed PBS input. */
import { createHash } from "node:crypto";
import { chmod, lstat, mkdtemp, readFile, readdir, readlink, realpath, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const run = promisify(execFile); const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = JSON.parse(await readFile(path.join(root, "managed-wren", "release-inputs.json"), "utf8")).python;
const digest = (value) => createHash("sha256").update(value).digest("hex");
function contained(root, target) { const relative = path.relative(root, target); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); }
async function treeDigest(root) {
  const entries = [];
  const visit = async (directory) => {
    for (const name of (await readdir(directory)).sort()) {
      if (name === "__pycache__") continue;
      const target = path.join(directory, name); const metadata = await lstat(target); const mode = (metadata.mode & 0o777).toString(8);
      if (metadata.isSymbolicLink()) { const canonical = await realpath(target); if (!contained(root, canonical)) throw new Error("PBS link escapes tree"); entries.push(path.relative(root, target) + "\0" + mode + "\0link\0" + await readlink(target)); }
      else if (metadata.isDirectory()) await visit(target); else if (metadata.isFile()) entries.push(path.relative(root, target) + "\0" + mode + "\0file\0" + digest(await readFile(target))); else throw new Error("unsupported PBS tree entry");
    }
  };
  await visit(root); return digest(entries.join("\n"));
}
async function extractWithUmask(archive, target, umask) {
  await run("/bin/sh", ["-c", "umask \"$1\"; exec /usr/bin/tar -xpzf \"$2\" -C \"$3\"", "managed-wren-pbs", umask, archive, target]);
}
const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), "genbi-pbs-probe-")));
try {
  const archive = path.join(temp, input.filename); await run("/usr/bin/curl", ["--fail", "--location", "--proto", "=https", "--tlsv1.2", "-o", archive, input.url]);
  if (digest(await readFile(archive)) !== input.sha256) throw new Error("PBS hash mismatch");
  const staging = path.join(temp, "staging-022"), alternate = path.join(temp, "staging-077"), final = path.join(temp, "final"); await run("/bin/mkdir", [staging]); await run("/bin/mkdir", [alternate]);
  await extractWithUmask(archive, staging, "022"); await extractWithUmask(archive, alternate, "077"); await chmod(staging, 0o700); await chmod(alternate, 0o700);
  const pythonTreeSha256 = await treeDigest(path.join(staging, "python"));
  if (pythonTreeSha256 !== await treeDigest(path.join(alternate, "python"))) throw new Error("PBS tree digest depends on umask");
  await run(path.join(staging, "python", "bin", "python3.11"), ["-m", "venv", "--copies", path.join(staging, "venv")]); await run("/bin/mv", [staging, final]);
  const config = path.join(final, "venv", "pyvenv.cfg"); const text = (await readFile(config, "utf8")).split(staging).join(final); if (text.includes(staging)) throw new Error("staging reference remains"); await writeFile(config, text, { mode: 0o600 });
  const launcher = path.join(final, "venv", "bin", "wren-probe"); await writeFile(launcher, `#!${path.join(final, "venv", "bin", "python")}\nimport sys; print(sys.executable)\n`, { mode: 0o700 }); await chmod(launcher, 0o700);
  const { stdout } = await run(launcher, []); if (stdout.trim() !== path.join(final, "venv", "bin", "python")) throw new Error("promoted launcher mismatch"); console.log(`ok sha256=${input.sha256} pythonTreeSha256=${pythonTreeSha256}`);
} finally { if (path.basename(temp).startsWith("genbi-pbs-probe-")) await rm(temp, { recursive: true, force: true }); }
