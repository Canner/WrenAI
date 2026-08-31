#!/usr/bin/env node
/**
 * Harness runner (Setup dispatcher capture/replay, deliverable #3).
 *
 * Boots a REAL BFF process (`dist-server/server/bin.js` — the exact file `pnpm run start:bff`
 * runs) in bootstrap mode, on a spare port, against a throwaway SQLite DB in a fresh temp
 * directory, with `WREN_HARNESS_AGENT_SDK_BIN` / `WREN_HARNESS_CODEX_LOCAL_BIN` both pointed at
 * `replay-wrapper.mjs` (deliverable #2) instead of a real dispatcher binary. It then drives the
 * Setup wizard's connect step over the BFF's real HTTP route (`POST /api/setup/connect`) and its
 * real SSE route (`GET /api/sessions/:id/stream`), and reports what actually happened.
 *
 * No network call, no model call, no live login probe: `WREN_HARNESS_MODE=subscription` with
 * `WREN_HARNESS_PROVIDER=claude` makes `resolveAuthChoice` (harness/cli-args.ts) take the
 * explicit-mode branch and return immediately — `createDefaultLoginProbe()` is constructed but
 * never invoked. See this file's own inline citations below for where each claim was checked.
 *
 * ## Usage
 *
 *   pnpm run build        # produces dist-server/server/bin.js — this script refuses to run without it
 *   node harness/replay/run-harness.mjs
 *
 * Optional env overrides: `WREN_HARNESS_RUN_PORT` (default 4799 — a spare port, clearly distinct
 * from the manual session's reserved 4790/5276/4791/5277), `WREN_HARNESS_RUN_CASSETTE_DIR`
 * (default `test/fixtures/cassettes`), `WREN_HARNESS_CASSETTE_SCENARIO` (default `"default"`).
 *
 * ## Honest limits — read this before trusting a green run
 *
 * At the time this script was written, `test/fixtures/cassettes/` holds no real dispatcher
 * recording (see harness/replay/README.md for why: capturing one requires a live
 * personal-subscription turn, which this work packet does not authorize). Without a cassette for
 * key `"chat__connect_source__default"`, the connect turn WILL fail — the replay wrapper exits
 * 66 (`MISSING_CASSETTE_EXIT_CODE`) because there is nothing to replay. This script detects that
 * case and reports it as the expected outcome given the current (empty) cassette directory,
 * rather than as a bug in the harness. It still proves real, valuable things in that state: the
 * BFF boots in bootstrap mode, `POST /api/setup/connect` accepts the request and dispatches a
 * real turn through the real `DispatchedSetupRunner` → real spawn → the real
 * `WREN_HARNESS_AGENT_SDK_BIN` executable, and the SSE stream reports the resulting failure
 * instead of hanging silently. What it does NOT prove without a real cassette: that the recorded
 * bytes correctly drive `server/fold.ts` and the setup terminal gate to an `ok` outcome — that
 * requires an actual recording, checked in once sanitized (deliverable #6/#7).
 *
 * Once a real cassette for that key exists, this script's behavior changes automatically (see the
 * `cassetteExists` branch below) to report on the actual terminal outcome instead.
 */
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// `--component connect_source` is CONNECT_SOURCE_AGENT_ID (harness/setup/runner.ts); `"chat"` is
// the dispatched subcommand literal (harness/route/dispatched.ts's buildAgentSdkChatArgs). See
// cassette-key.mjs's doc comment for the full keying rule.
const CONNECT_CASSETTE_KEY = "chat__connect_source__default";
const READY_TIMEOUT_MS = 15000;
const SSE_TIMEOUT_MS = 20000;

async function main() {
  const port = Number.parseInt(process.env.WREN_HARNESS_RUN_PORT ?? "4799", 10);
  const cassetteDir = process.env.WREN_HARNESS_RUN_CASSETTE_DIR ?? path.join(PACKAGE_ROOT, "test", "fixtures", "cassettes");
  const distBin = path.join(PACKAGE_ROOT, "dist-server", "server", "bin.js");

  if (!existsSync(distBin)) {
    process.stderr.write(`run-harness: ${distBin} not found. Run \`pnpm run build\` first, then re-run this script.\n`);
    process.exitCode = 70;
    return;
  }

  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "wren-harness-run-"));
  const workspaceRoot = path.join(tmpRoot, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const dbPath = path.join(tmpRoot, "harness-bff.sqlite");
  const replayWrapper = path.join(PACKAGE_ROOT, "harness", "replay", "replay-wrapper.mjs");

  process.stdout.write(`run-harness: temp workspace ${tmpRoot}\n`);

  const env = { ...process.env };
  Object.assign(env, {
    PORT: String(port),
    WREN_BFF_DB_PATH: dbPath,
    WREN_HARNESS_WORKSPACE_ROOT: workspaceRoot,
    WREN_HARNESS_MODE: "subscription",
    WREN_HARNESS_PROVIDER: "claude",
    WREN_HARNESS_AGENT_SDK_BIN: replayWrapper,
    WREN_HARNESS_CODEX_LOCAL_BIN: replayWrapper,
    WREN_HARNESS_CASSETTE_DIR: cassetteDir,
    WREN_HARNESS_CASSETTE_SCENARIO: process.env.WREN_HARNESS_CASSETTE_SCENARIO ?? "default",
  });

  const child = spawn(process.execPath, [distBin], { env, stdio: ["ignore", "pipe", "pipe"] });
  let stdoutBuf = "";
  let stderrBuf = "";
  child.stdout.on("data", (chunk) => {
    stdoutBuf += chunk.toString("utf-8");
  });
  child.stderr.on("data", (chunk) => {
    stderrBuf += chunk.toString("utf-8");
  });

  let exitedEarly = null;
  child.on("exit", (code) => {
    exitedEarly = code;
  });

  try {
    await waitForReady(() => stdoutBuf, () => exitedEarly, READY_TIMEOUT_MS);
    process.stdout.write(`run-harness: BFF ready on http://localhost:${port} (db: ${dbPath})\n`);

    const base = `http://localhost:${port}`;
    const connectRes = await fetch(`${base}/api/setup/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectName: "harness_probe", sourceType: "duckdb" }),
    });
    const connectBody = await connectRes.json();
    process.stdout.write(`run-harness: POST /api/setup/connect -> ${connectRes.status} ${JSON.stringify(connectBody)}\n`);

    if (connectRes.status !== 200) {
      throw new Error(`unexpected /api/setup/connect status ${connectRes.status}: ${JSON.stringify(connectBody)}`);
    }
    const { sessionId, turnId } = connectBody;
    if (typeof sessionId !== "string" || typeof turnId !== "string") {
      throw new Error(`/api/setup/connect response missing sessionId/turnId: ${JSON.stringify(connectBody)}`);
    }

    const cassetteExists = existsSync(path.join(cassetteDir, `${CONNECT_CASSETTE_KEY}.ndjson`));
    process.stdout.write(
      `run-harness: cassette for key "${CONNECT_CASSETTE_KEY}" ${cassetteExists ? "FOUND" : "NOT FOUND"} in ${cassetteDir}\n`,
    );

    const frames = await collectSse(`${base}/api/sessions/${sessionId}/stream?turn=${turnId}`, SSE_TIMEOUT_MS);
    process.stdout.write(`run-harness: collected ${frames.length} SSE frame(s)\n`);
    for (const frame of frames) {
      process.stdout.write(`  frame: event=${frame.event} data=${frame.data.slice(0, 300)}\n`);
    }

    if (cassetteExists) {
      process.stdout.write(
        "run-harness: a cassette exists for this key — inspect the frames above for the actual " +
          "terminal outcome (this script does not yet assert a specific one; see README's TODO).\n",
      );
    } else {
      const combined = frames.map((f) => f.data).join("\n");
      const sawMissingCassetteSignal = /66|cassette/i.test(combined) || /66|cassette/i.test(stderrBuf);
      process.stdout.write(
        `run-harness: EXPECTED outcome given an empty cassette directory — the connect turn should ` +
          `fail because the replay wrapper had nothing to replay for key "${CONNECT_CASSETTE_KEY}". ` +
          `missing-cassette signal observed in stream or dispatcher stderr: ${sawMissingCassetteSignal}\n`,
      );
      if (!sawMissingCassetteSignal) {
        process.stdout.write(
          "run-harness: WARNING — expected a missing-cassette signal but did not clearly see one; " +
            "inspect the frames/stderr above by hand before trusting this run.\n",
        );
      }
    }

    process.stdout.write("run-harness: done.\n");
  } finally {
    child.kill();
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * @param {() => string} getStdout
 * @param {() => number | null} getExitCode
 * @param {number} timeoutMs
 */
function waitForReady(getStdout, getExitCode, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (getStdout().includes("listening on")) {
        clearInterval(interval);
        resolve();
        return;
      }
      const code = getExitCode();
      if (code !== null) {
        clearInterval(interval);
        reject(new Error(`BFF process exited (code ${code}) before reporting ready. stdout so far:\n${getStdout()}`));
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error(`BFF did not report ready within ${timeoutMs}ms. stdout so far:\n${getStdout()}`));
      }
    }, 100);
  });
}

/**
 * Reads a `text/event-stream` response until the stream closes or `timeoutMs` elapses, whichever
 * comes first, returning the frames collected so far. A `close`/`error` frame from `streamTurn`
 * (server/app.ts) ends the underlying turn but this function does not special-case any frame name
 * — it just drains what the real route sends and hands it back for the caller to report on
 * honestly.
 *
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<{ event: string; data: string }[]>}
 */
async function collectSse(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const frames = [];
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok || !res.body) {
      frames.push({ event: "error", data: `non-SSE response: ${res.status}` });
      return frames;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sepIndex;
      // SSE frames are separated by a blank line ("\n\n").
      while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
        const rawFrame = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        const eventLine = rawFrame.split("\n").find((l) => l.startsWith("event:"));
        const dataLine = rawFrame.split("\n").find((l) => l.startsWith("data:"));
        frames.push({
          event: eventLine ? eventLine.slice("event:".length).trim() : "message",
          data: dataLine ? dataLine.slice("data:".length).trim() : "",
        });
      }
    }
  } catch (error) {
    frames.push({ event: "harness-collect-error", data: String(error) });
  } finally {
    clearTimeout(timer);
  }
  return frames;
}

main().catch((error) => {
  process.stderr.write(`run-harness: fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
