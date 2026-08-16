/**
 * Wrapper unit tests (Setup dispatcher capture/replay, deliverables #1/#2).
 *
 * Exercises `harness/replay/capture-wrapper.mjs` and `harness/replay/replay-wrapper.mjs` directly,
 * as separate processes — not by importing their internals — because their entire job is to be
 * transparent about a real process boundary (argv/stdin/stdout/exit code), and that is only
 * meaningfully testable by actually spawning them.
 *
 * The "dispatcher" these tests point the capture wrapper at is `test/fixtures/fake-dispatcher.mjs`,
 * an intentionally synthetic fixture (see its own doc comment) — using it keeps this test free of
 * any claim about a real dispatcher's wire shape: nothing here fabricates a neighbouring layer's
 * output, it only checks that the wrapper faithfully relays whatever a subprocess actually did.
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error -- plain .mjs, not covered by tsconfig.server.json's `include` (see
// test/cassette-sanitize.test.ts for the same note); the runtime import works fine under
// vitest/Node's ESM loader, this only silences the TS "could not find declaration" noise.
import { computeCassetteKey } from "../harness/replay/cassette-key.mjs";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(TEST_DIR, "..");
const CAPTURE_WRAPPER = path.join(PACKAGE_ROOT, "harness", "replay", "capture-wrapper.mjs");
const REPLAY_WRAPPER = path.join(PACKAGE_ROOT, "harness", "replay", "replay-wrapper.mjs");
const FAKE_DISPATCHER = path.join(TEST_DIR, "fixtures", "fake-dispatcher.mjs");

/**
 * Spawns `bin` with `args`, writes `stdin` (if any) and closes it, and resolves with the
 * collected stdout/stderr/exit code/signal once the process exits.
 */
function run(
  bin: string,
  args: readonly string[],
  options: { env?: Record<string, string | undefined>; stdin?: string } = {},
): Promise<{ stdout: string; stderr: string; code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({ stdout, stderr, code, signal });
    });
    if (options.stdin !== undefined) {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();
  });
}

describe("computeCassetteKey (harness/replay/cassette-key.mjs)", () => {
  it("keys on subcommand + --component + scenario, ignoring volatile argv", () => {
    const argv = ["chat", "--component", "connect_source", "--project", "/tmp/wren-harness-run-abc123/acme", "--out", "/tmp/x/out.json"];
    expect(computeCassetteKey(argv, "default")).toBe("chat__connect_source__default");
  });

  it("falls back to 'unknown' for a missing --component", () => {
    expect(computeCassetteKey(["dispatch"], "default")).toBe("dispatch__unknown__default");
  });

  it("falls back to 'unknown' subcommand for empty argv", () => {
    expect(computeCassetteKey([], "default")).toBe("unknown__unknown__default");
  });

  it("rejects an unsafe scenario and falls back to 'default'", () => {
    expect(computeCassetteKey(["chat", "--component", "connect_source"], "../../etc")).toBe("chat__connect_source__default");
    expect(computeCassetteKey(["chat", "--component", "connect_source"], "has spaces")).toBe("chat__connect_source__default");
  });

  it("accepts a safe custom scenario", () => {
    expect(computeCassetteKey(["chat", "--component", "connect_source"], "error-case_1")).toBe("chat__connect_source__error-case_1");
  });
});

describe("capture-wrapper.mjs transparency", () => {
  let cassetteDir: string;

  beforeEach(async () => {
    cassetteDir = await mkdtemp(path.join(tmpdir(), "wren-harness-capture-test-"));
  });

  afterEach(async () => {
    await rm(cassetteDir, { recursive: true, force: true });
  });

  const forwardedArgv = ["chat", "--component", "connect_source"];
  const stdinPayload = "hello from the capture-wrapper test\n";

  it("relays argv, stdin, stdout, and a zero exit code exactly like running the fixture directly", async () => {
    const direct = await run(process.execPath, [FAKE_DISPATCHER, ...forwardedArgv], { stdin: stdinPayload });

    const wrapped = await run(process.execPath, [CAPTURE_WRAPPER, ...forwardedArgv], {
      env: {
        ...process.env,
        WREN_HARNESS_CASSETTE_REAL_BIN: process.execPath,
        WREN_HARNESS_CASSETTE_REAL_ARGS_PREFIX: JSON.stringify([FAKE_DISPATCHER]),
        WREN_HARNESS_CASSETTE_DIR: cassetteDir,
      },
      stdin: stdinPayload,
    });

    expect(wrapped.code).toBe(direct.code);
    expect(wrapped.code).toBe(0);
    expect(wrapped.stdout).toBe(direct.stdout);
    // The fixture's own JSON line proves argv and stdin really did travel through the wrapper
    // unchanged, not just that the two stdout strings happen to match.
    const parsed = JSON.parse(direct.stdout.trim());
    expect(parsed.argv).toEqual(forwardedArgv);
    expect(parsed.stdin).toBe(stdinPayload);
  });

  it("relays a non-zero exit code", async () => {
    const wrapped = await run(process.execPath, [CAPTURE_WRAPPER, ...forwardedArgv], {
      env: {
        ...process.env,
        WREN_HARNESS_CASSETTE_REAL_BIN: process.execPath,
        WREN_HARNESS_CASSETTE_REAL_ARGS_PREFIX: JSON.stringify([FAKE_DISPATCHER]),
        WREN_HARNESS_CASSETTE_DIR: cassetteDir,
        FAKE_DISPATCHER_EXIT_CODE: "3",
      },
      stdin: stdinPayload,
    });
    expect(wrapped.code).toBe(3);
  });

  it("tees exactly the forwarded stdout bytes into a cassette keyed by computeCassetteKey", async () => {
    const wrapped = await run(process.execPath, [CAPTURE_WRAPPER, ...forwardedArgv], {
      env: {
        ...process.env,
        WREN_HARNESS_CASSETTE_REAL_BIN: process.execPath,
        WREN_HARNESS_CASSETTE_REAL_ARGS_PREFIX: JSON.stringify([FAKE_DISPATCHER]),
        WREN_HARNESS_CASSETTE_DIR: cassetteDir,
      },
      stdin: stdinPayload,
    });
    expect(wrapped.code).toBe(0);

    const key = computeCassetteKey(forwardedArgv, "default");
    expect(key).toBe("chat__connect_source__default");

    const cassetteContent = await readFile(path.join(cassetteDir, `${key}.ndjson`), "utf-8");
    expect(cassetteContent).toBe(wrapped.stdout);

    const meta = JSON.parse(await readFile(path.join(cassetteDir, `${key}.meta.json`), "utf-8"));
    expect(meta.exitCode).toBe(0);
    expect(meta.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Deliberately does not carry argv or any path — see capture-wrapper.mjs's own doc comment.
    expect(meta).not.toHaveProperty("argv");
  });
});

describe("replay-wrapper.mjs playback", () => {
  let cassetteDir: string;

  beforeEach(async () => {
    cassetteDir = await mkdtemp(path.join(tmpdir(), "wren-harness-replay-test-"));
  });

  afterEach(async () => {
    await rm(cassetteDir, { recursive: true, force: true });
  });

  const forwardedArgv = ["chat", "--component", "connect_source"];

  it("replays a recorded cassette's exact bytes and exit code", async () => {
    const key = computeCassetteKey(forwardedArgv, "default");
    // A synthetic, test-only line shape — same reasoning as fake-dispatcher.mjs: this cassette
    // does not claim to be a real dispatcher recording, it only proves the wrapper plays back
    // whatever bytes a cassette file holds, unmodified.
    const cassetteBody = '{"synthetic-test-line":1}\n{"synthetic-test-line":2}\n';
    await writeFile(path.join(cassetteDir, `${key}.ndjson`), cassetteBody, "utf-8");
    await writeFile(
      path.join(cassetteDir, `${key}.meta.json`),
      JSON.stringify({ capturedAt: "2026-08-07T00:00:00.000Z", exitCode: 5, signal: null }),
      "utf-8",
    );

    const result = await run(process.execPath, [REPLAY_WRAPPER, ...forwardedArgv], {
      env: { ...process.env, WREN_HARNESS_CASSETTE_DIR: cassetteDir },
    });

    expect(result.stdout).toBe(cassetteBody);
    expect(result.code).toBe(5);
  });

  it("exits 66 and names the missing key when no cassette matches", async () => {
    const result = await run(process.execPath, [REPLAY_WRAPPER, ...forwardedArgv], {
      env: { ...process.env, WREN_HARNESS_CASSETTE_DIR: cassetteDir },
    });

    expect(result.code).toBe(66);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("chat__connect_source__default");
  });

  it("never invents a response for an unrecorded scenario, even if the default scenario exists", async () => {
    const defaultKey = computeCassetteKey(forwardedArgv, "default");
    await writeFile(path.join(cassetteDir, `${defaultKey}.ndjson`), '{"only":"default-exists"}\n', "utf-8");

    const result = await run(process.execPath, [REPLAY_WRAPPER, ...forwardedArgv], {
      env: { ...process.env, WREN_HARNESS_CASSETTE_DIR: cassetteDir, WREN_HARNESS_CASSETTE_SCENARIO: "needs-decision" },
    });

    expect(result.code).toBe(66);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("chat__connect_source__needs-decision");
  });
});
