#!/usr/bin/env node
/**
 * Capture wrapper (Setup dispatcher capture/replay, deliverable #1).
 *
 * Point `WREN_HARNESS_AGENT_SDK_BIN` or `WREN_HARNESS_CODEX_LOCAL_BIN` at this script instead of
 * the real dispatcher binary, and it will run the real dispatcher underneath and tee its stdout to
 * a cassette file — with no product change and no knowledge of the dispatcher's own NDJSON
 * protocol. Guiding principle: record, don't reverse-engineer. It never invents an event; every
 * byte a cassette holds came out of a real dispatcher process on this machine.
 *
 * ## Transparency contract
 *
 * This wrapper must be indistinguishable from running the real dispatcher directly:
 *  - argv: forwarded byte-for-byte (`process.argv.slice(2)`), prefixed with any configured
 *    real-binary prefix args (e.g. warble's own dev-mode `tsx` invocation).
 *  - stdin: piped straight through, untouched.
 *  - stderr: inherited straight through, untouched.
 *  - stdout: forwarded to *this* process's stdout unchanged; the only side effect is an
 *    additional tee to the cassette file. A caller reading this wrapper's stdout sees exactly
 *    what it would have seen from the real dispatcher.
 *  - exit code / signal: this process exits the same way the real dispatcher did.
 *
 * ## Configuration (all via environment — never argv, so the wrapper's own argv stays identical
 * to what the real dispatcher would have received)
 *
 *  - `WREN_HARNESS_CASSETTE_REAL_BIN` (required): the real dispatcher command to exec.
 *  - `WREN_HARNESS_CASSETTE_REAL_ARGS_PREFIX` (optional): a JSON array of args to prepend before
 *    the forwarded argv (mirrors `ResolvedCli.prefixArgs`, e.g. a dev-mode `tsx <entry>` prefix).
 *  - `WREN_HARNESS_CASSETTE_DIR` (required): directory the cassette (`<key>.ndjson` +
 *    `<key>.meta.json`) is written into. Created if missing.
 *  - `WREN_HARNESS_CASSETTE_SCENARIO` (optional): forwarded to `computeCassetteKey` — see
 *    `cassette-key.mjs` for why this, and not argv content, disambiguates recordings.
 *
 * ## What this does NOT do
 *
 * It does not sanitize the cassette it writes — raw dispatcher stdout can carry absolute local
 * paths, workspace names, or credential echoes verbatim. Run `sanitize.mjs` against
 * `WREN_HARNESS_CASSETTE_DIR` before committing anything it produced (deliverable #6).
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { computeCassetteKey, metaFilename, ndjsonFilename } from "./cassette-key.mjs";

async function main() {
  const realBin = process.env.WREN_HARNESS_CASSETTE_REAL_BIN;
  const cassetteDir = process.env.WREN_HARNESS_CASSETTE_DIR;
  if (!realBin) {
    process.stderr.write("capture-wrapper: WREN_HARNESS_CASSETTE_REAL_BIN is not set — nothing to capture from.\n");
    process.exit(70);
  }
  if (!cassetteDir) {
    process.stderr.write("capture-wrapper: WREN_HARNESS_CASSETTE_DIR is not set — nowhere to write the cassette.\n");
    process.exit(70);
  }

  const prefixArgsRaw = process.env.WREN_HARNESS_CASSETTE_REAL_ARGS_PREFIX;
  let prefixArgs = [];
  if (prefixArgsRaw) {
    try {
      const parsed = JSON.parse(prefixArgsRaw);
      if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) {
        throw new Error("must be a JSON array of strings");
      }
      prefixArgs = parsed;
    } catch (error) {
      process.stderr.write(`capture-wrapper: WREN_HARNESS_CASSETTE_REAL_ARGS_PREFIX is not valid — ${String(error)}\n`);
      process.exit(70);
    }
  }

  const forwardedArgv = process.argv.slice(2);
  await mkdir(cassetteDir, { recursive: true });
  const key = computeCassetteKey(forwardedArgv);
  const ndjsonPath = path.join(cassetteDir, ndjsonFilename(key));
  const metaPath = path.join(cassetteDir, metaFilename(key));
  const cassetteStream = createWriteStream(ndjsonPath, { flags: "w" });

  const child = spawn(realBin, [...prefixArgs, ...forwardedArgv], { stdio: ["pipe", "pipe", "inherit"] });

  process.stdin.pipe(child.stdin);

  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    cassetteStream.write(chunk);
  });

  child.on("error", (error) => {
    process.stderr.write(`capture-wrapper: failed to spawn real dispatcher "${realBin}": ${String(error)}\n`);
    cassetteStream.end();
    process.exit(71);
  });

  child.on("close", (code, signal) => {
    cassetteStream.end(async () => {
      const meta = {
        capturedAt: new Date().toISOString(),
        exitCode: code,
        signal,
        // Deliberately excludes argv/paths — see this module's doc comment and
        // `harness/replay/README.md`'s sanitization section for why.
        note: "Recorded by capture-wrapper.mjs. Run sanitize.mjs against this directory before committing.",
      };
      await mkdirAndWrite(metaPath, JSON.stringify(meta, null, 2) + "\n");
      if (signal) {
        // Re-raise the same signal against ourselves so a caller waiting on this process sees the
        // same termination mode the real dispatcher would have produced.
        process.kill(process.pid, signal);
        return;
      }
      process.exit(code ?? 1);
    });
  });
}

async function mkdirAndWrite(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(filePath, content, "utf-8");
}

main().catch((error) => {
  process.stderr.write(`capture-wrapper: unexpected failure: ${String(error)}\n`);
  process.exit(1);
});
