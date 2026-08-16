/**
 * Self-test for the cassette sanitization check (Setup dispatcher capture/replay, deliverable #6).
 *
 * A sanitizer nobody has ever seen fail is not a verified sanitizer — this asserts
 * `harness/replay/sanitize.mjs`'s `scanText`/`scanCassetteDir` actually fire on deliberately
 * dirty input (an absolute local path, a personal tracker ID, a credential-like assignment, and
 * an org-specific name supplied via the local `extraPatterns` extensibility mechanism), and stay
 * silent on clean, realistic cassette content.
 *
 * The built-in pattern list is deliberately generic (see `sanitize.mjs`'s own doc comment): it
 * never hardcodes a specific private repo or organization name, because this file — like
 * `sanitize.mjs` itself — lives in a public repository. Anywhere this test needs to stand in for
 * an org-specific secret, it uses an obviously fictional example name/path rather than a real one.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error -- plain .mjs, not covered by tsconfig.server.json's `include` (see this
// packet's notes on why new operational scripts are .mjs); the runtime import still works fine
// under vitest/Node's ESM loader, this only silences the TS "could not find declaration" noise.
import { scanCassetteDir, scanText } from "../harness/replay/sanitize.mjs";

describe("cassette sanitization (harness/replay/sanitize.mjs)", () => {
  it("scanText flags an absolute local home path", () => {
    const findings = scanText('{"note":"ran from /Users/example/agent-workspace/repos/some-project"}');
    expect(findings.some((f: { pattern: string }) => f.pattern === "absolute-unix-home-path")).toBe(true);
  });

  it("scanText flags an org-specific name via a supplied extraPattern, without hardcoding it as a built-in", () => {
    const extraPatterns = [{ name: "example-internal-codename", source: "acme-internal-codename" }];
    const dirty = scanText("compiled against acme-internal-codename at HEAD", extraPatterns);
    const clean = scanText("compiled against acme-internal-codename at HEAD"); // no extraPatterns supplied
    expect(dirty.some((f: { pattern: string }) => f.pattern === "example-internal-codename")).toBe(true);
    expect(clean.some((f: { pattern: string }) => f.pattern === "example-internal-codename")).toBe(false);
  });

  it("flags an issue-tracker key only via a supplied prefix, never as a built-in", () => {
    const extraPatterns = [{ name: "example-tracker-key", source: "\\bACME-\\d+\\b" }];
    const dirty = scanText("fixing ACME-42 before lunch", extraPatterns);
    const clean = scanText("fixing ACME-42 before lunch");
    expect(dirty.some((f: { pattern: string }) => f.pattern === "example-tracker-key")).toBe(true);
    // A prefix names the tracker it belongs to, so no built-in may hardcode one. A generic
    // `[A-Z]{2,6}-\d+` catch-all is also rejected: it fires on ordinary technical tokens.
    expect(clean).toEqual([]);
    expect(scanText("encoded as UTF-8 with SHA-256 digests")).toEqual([]);
  });

  it("scanText flags a credential-like assignment", () => {
    const findings = scanText('export API_KEY="sk-not-a-real-secret-abcdefgh"');
    expect(findings.length).toBeGreaterThan(0);
  });

  it("scanText flags a dispatcher/agent-SDK session id and an Anthropic tool-use id", () => {
    // Both ids below are invented for this test — never a value that has appeared in a real
    // cassette — because a detector must never embed the exact identifiers it exists to catch.
    const sessionFindings = scanText('{"t":"session","id":"11111111-2222-4333-8444-555555555555"}');
    expect(sessionFindings.some((f: { pattern: string }) => f.pattern === "uuid-session-id")).toBe(true);

    const toolUseFindings = scanText('{"t":"tool_call","id":"toolu_notARealId0123456789"}');
    expect(toolUseFindings.some((f: { pattern: string }) => f.pattern === "anthropic-tool-use-id")).toBe(true);
  });

  it("scanText stays silent on clean, realistic cassette content", () => {
    const findings = scanText(
      '{"t":"tool_result","id":"call-1","ok":true,"summary":"[{\\"table_name\\":\\"customers\\"}]"}\n' +
        '{"t":"answer","text":"built MDL with 1 model"}\n',
    );
    expect(findings).toEqual([]);
  });

  describe("scanCassetteDir", () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(path.join(tmpdir(), "wren-harness-sanitize-test-"));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it("returns [] for a directory that does not exist yet", async () => {
      const results = await scanCassetteDir(path.join(dir, "does-not-exist"));
      expect(results).toEqual([]);
    });

    it("returns [] for a clean cassette directory", async () => {
      await writeFile(path.join(dir, "chat__connect_source__default.ndjson"), '{"t":"answer","text":"ok"}\n', "utf-8");
      await writeFile(
        path.join(dir, "chat__connect_source__default.meta.json"),
        JSON.stringify({ capturedAt: "2026-08-07T00:00:00.000Z", exitCode: 0, signal: null }),
        "utf-8",
      );
      const results = await scanCassetteDir(dir);
      expect(results).toEqual([]);
    });

    it("fails (returns non-empty findings) for a deliberately dirty cassette file", async () => {
      await writeFile(
        path.join(dir, "chat__connect_source__default.ndjson"),
        '{"t":"tool_result","id":"call-1","ok":true,"summary":"ran from /Users/example/dev/some-project with token=hunter2hunter2"}\n',
        "utf-8",
      );
      const results = await scanCassetteDir(dir);
      expect(results.length).toBe(1);
      expect(results[0]?.findings.length).toBeGreaterThan(0);
      const patterns = results[0]?.findings.map((f: { pattern: string }) => f.pattern) ?? [];
      expect(patterns).toContain("absolute-unix-home-path");
      expect(patterns).toContain("credential-like-assignment");
    });

    it("ignores non-cassette files in the same directory", async () => {
      await writeFile(path.join(dir, "README.md"), "/Users/example/should-be-ignored\n", "utf-8");
      const results = await scanCassetteDir(dir);
      expect(results).toEqual([]);
    });
  });
});
