#!/usr/bin/env node
/**
 * Replay wrapper (Setup dispatcher capture/replay, deliverable #2).
 *
 * Point `WREN_HARNESS_AGENT_SDK_BIN` or `WREN_HARNESS_CODEX_LOCAL_BIN` at this script and it plays
 * back a previously-recorded cassette (see `capture-wrapper.mjs`) as the dispatcher's stdout,
 * instead of spawning any real dispatcher or model. No network call, no model cost.
 *
 * ## Cassette selection
 *
 * Deterministic — see `cassette-key.mjs`'s doc comment for the full rule and why it excludes
 * volatile argv (temp paths). In short: `key = "<subcommand>__<component>__<scenario>"`, computed
 * from this wrapper's own forwarded argv plus `WREN_HARNESS_CASSETTE_SCENARIO`.
 *
 * ## Configuration
 *
 *  - `WREN_HARNESS_CASSETTE_DIR` (required): directory to look up `<key>.ndjson` +
 *    `<key>.meta.json` in.
 *  - `WREN_HARNESS_CASSETTE_SCENARIO` (optional, default `"default"`).
 *  - `WREN_HARNESS_CASSETTE_REPLAY_DELAY_MS` (optional, default `0`): a per-line delay, purely
 *    cosmetic (lets a human watching the UI see the work log fill in incrementally instead of all
 *    at once). Never required for correctness — every consumer here reads to EOF regardless.
 *
 * ## Missing-cassette behavior — this is a deliberate, distinguishable failure, not a silent
 * no-op or a fabricated response
 *
 * If no cassette matches the computed key, this wrapper exits with code 66 (`EX_NOINPUT`, chosen
 * to be distinguishable from both a normal dispatcher failure and this wrapper's own bugs) and
 * writes a one-line diagnostic to stderr naming the missing key and the directory searched. It
 * never invents a plausible-looking response for a key it has no recording for — doing so would
 * be exactly the "hand-authored fixture claiming to be another layer's output" problem this whole
 * capture/replay design exists to avoid, just relocated into this wrapper instead of a test file.
 *
 * ## Staleness
 *
 * This wrapper does not validate that a cassette's lines still match the current dispatcher
 * protocol — it doesn't parse them at all, just re-emits the bytes. That validation happens for
 * free, downstream, in the real code this harness is exercising: `harness/route/chat-event-
 * mapper.ts`'s `parseWarbleChatEventLine` (dispatched) / the Codex event mapper drop any line that
 * doesn't structurally match their current vocabulary, silently for a single malformed line but
 * visibly (a stalled or errored turn, an empty work log) if a whole cassette has gone stale
 * against a changed protocol. A cassette recorded against an old wire shape does not cause a
 * false "ok" — the real parser it flows through never accepted the old shape as the new one. See
 * `harness/replay/README.md`'s "staleness" section for the refresh procedure.
 */
import { createReadStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { computeCassetteKey, metaFilename, ndjsonFilename } from "./cassette-key.mjs";

const MISSING_CASSETTE_EXIT_CODE = 66;

async function main() {
  const cassetteDir = process.env.WREN_HARNESS_CASSETTE_DIR;
  if (!cassetteDir) {
    process.stderr.write("replay-wrapper: WREN_HARNESS_CASSETTE_DIR is not set — nowhere to read a cassette from.\n");
    process.exit(70);
    return;
  }

  // Drain and discard stdin unconditionally: a real caller may write a question/prompt and close
  // stdin (dispatched) or write nothing at all (Codex, which never touches this wrapper's stdin). This
  // wrapper never reads stdin content — a cassette is a canned reply keyed on argv, not on the
  // request text — but it must not let an un-drained pipe hang the caller waiting on `stdin.end()`
  // to flush.
  process.stdin.resume();

  const forwardedArgv = process.argv.slice(2);
  const key = computeCassetteKey(forwardedArgv);
  const ndjsonPath = path.join(cassetteDir, ndjsonFilename(key));
  const metaPath = path.join(cassetteDir, metaFilename(key));

  const exists = await access(ndjsonPath).then(
    () => true,
    () => false,
  );
  if (!exists) {
    process.stderr.write(
      `replay-wrapper: no cassette recorded for key "${key}" (looked for ${ndjsonPath}). ` +
        `Record one with capture-wrapper.mjs — see harness/replay/README.md.\n`,
    );
    process.exit(MISSING_CASSETTE_EXIT_CODE);
    return;
  }

  const delayMs = Number.parseInt(process.env.WREN_HARNESS_CASSETTE_REPLAY_DELAY_MS ?? "0", 10) || 0;
  let meta = { exitCode: 0, signal: null };
  try {
    meta = JSON.parse(await readFile(metaPath, "utf-8"));
  } catch {
    // No/invalid meta file: fall back to a clean exit. The ndjson content still replays as-is.
  }

  await replay(ndjsonPath, delayMs);

  if (meta.signal) {
    process.kill(process.pid, meta.signal);
    return;
  }
  process.exit(typeof meta.exitCode === "number" ? meta.exitCode : 0);
}

/** @param {string} ndjsonPath @param {number} delayMs */
async function replay(ndjsonPath, delayMs) {
  const content = await new Promise((resolve, reject) => {
    const chunks = [];
    const stream = createReadStream(ndjsonPath);
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });

  if (delayMs <= 0) {
    process.stdout.write(content);
    return;
  }

  const lines = content.toString("utf-8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const isLast = i === lines.length - 1;
    const line = lines[i];
    if (line.length === 0 && isLast) continue; // trailing newline artifact, not a real line
    process.stdout.write(isLast ? line : `${line}\n`);
    if (!isLast) await sleep(delayMs);
  }
}

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  process.stderr.write(`replay-wrapper: unexpected failure: ${String(error)}\n`);
  process.exit(1);
});
