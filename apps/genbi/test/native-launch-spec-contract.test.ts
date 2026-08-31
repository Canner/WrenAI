import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildNativeLaunchSpec } from "./native-launch-spec.js";
import { WARBLE_REPO } from "./warble-checkout.js";

/** This package's own `profiles/` tree — the GenBI profiles now live here, not in a Warble checkout. */
const PROFILES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "profiles");

const WARBLE_BIN = path.join(WARBLE_REPO, "target", "release", "warble");
const SETUP_IR = path.join(PROFILES_DIR, "genbi-setup", "ir.golden.json");
const canRun = existsSync(WARBLE_BIN) && existsSync(SETUP_IR);

/**
 * The reason `native-launch-spec.ts` is allowed to exist.
 *
 * Every other test builds its launch spec from that helper, which makes them fast and hermetic but
 * also makes them a description of Warble's output rather than a check on it — exactly the kind of
 * hand-maintained mirror that stays green while drifting. This test closes that gap by dispatching
 * with the real binary and asserting the helper still describes what came out.
 *
 * It is opt-in: with no local Warble checkout there is nothing to compare against, and the unit
 * tests remain covered by the helper. When it does run, a Warble format change fails here, in one
 * place, instead of silently invalidating four files' worth of expectations.
 */
describe.skipIf(!canRun)("native launch spec helper matches the real dispatcher [opt-in integration]", () => {
  it("reproduces the v4 spec warble emits for a setup session", () => {
    const out = mkdtempSync(path.join(tmpdir(), "genbi-launch-contract-"));
    const bootstrapRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "genbi-launch-bootstrap-")));
    const scopePath = path.join(out, "scope.json");
    const entryVerb = "connect_source";
    const welcome = "Contract-test first turn.";
    const scope = {
      version: "3",
      kind: "bootstrap",
      scope_id: "contract-scope",
      cwd: realpathSync(out),
      entry: { verb: entryVerb, prompt: welcome },
      bootstrap_root: bootstrapRoot,
    };
    mkdirSync(path.dirname(scopePath), { recursive: true });
    require("node:fs").writeFileSync(scopePath, JSON.stringify(scope));

    execFileSync(WARBLE_BIN, [
      "dispatch", SETUP_IR, "--target", "claude-code:interactive",
      "--out", realpathSync(out), "--purpose", "setup", "--native-scope", scopePath,
    ], { stdio: "pipe" });

    const emitted = JSON.parse(readFileSync(path.join(realpathSync(out), ".warble", "interactive-launch.json"), "utf-8"));
    const expected = buildNativeLaunchSpec({
      version: "2", target: "claude-code:interactive", purpose: "setup",
      out: realpathSync(out), scope: emitted.scope, entryVerb,
    });

    // argv and agent are the contract the host validates byte-for-byte; comparing them alone keeps
    // this test about the shape the helper claims, not about fields the host never inspects.
    expect(emitted.argv).toEqual(expected.argv);
    expect(emitted.agent).toEqual(expected.agent);
    expect(emitted.version).toEqual(expected.version);
  });
});
