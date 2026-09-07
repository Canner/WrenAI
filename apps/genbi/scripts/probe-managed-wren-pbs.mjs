#!/usr/bin/env node
/** Non-publishing reproducibility probe for the exact managed PBS input. */
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const run = promisify(execFile); const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = JSON.parse(await readFile(path.join(root, "managed-wren", "release-inputs.json"), "utf8")).python;
const temp = await mkdtemp(path.join(os.tmpdir(), "genbi-pbs-probe-"));
try {
  const archive = path.join(temp, input.filename); await run("/usr/bin/curl", ["--fail", "--location", "--proto", "=https", "--tlsv1.2", "-o", archive, input.url]);
  if (createHash("sha256").update(await readFile(archive)).digest("hex") !== input.sha256) throw new Error("PBS hash mismatch");
  const staging = path.join(temp, "staging"), final = path.join(temp, "final"); await run("/bin/mkdir", [staging]); await run("/usr/bin/tar", ["-xzf", archive, "-C", staging]);
  await run(path.join(staging, "python", "bin", "python3.11"), ["-m", "venv", "--copies", path.join(staging, "venv")]); await run("/bin/mv", [staging, final]);
  const config = path.join(final, "venv", "pyvenv.cfg"); const text = (await readFile(config, "utf8")).split(staging).join(final); if (text.includes(staging)) throw new Error("staging reference remains"); await writeFile(config, text, { mode: 0o600 });
  const launcher = path.join(final, "venv", "bin", "wren-probe"); await writeFile(launcher, `#!${path.join(final, "venv", "bin", "python")}\nimport sys; print(sys.executable)\n`, { mode: 0o700 }); await chmod(launcher, 0o700);
  const { stdout } = await run(launcher, []); if (stdout.trim() !== path.join(final, "venv", "bin", "python")) throw new Error("promoted launcher mismatch"); console.log(`ok sha256=${input.sha256}`);
} finally { if (path.basename(temp).startsWith("genbi-pbs-probe-")) await rm(temp, { recursive: true, force: true }); }
