import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDefaultLoginProbe, type AuthChoice } from "../harness/auth/index.js";
import { resolveWarbleBinary } from "../harness/compile/resolve-binary.js";
import { ANTHROPIC_ADAPTER_ID } from "../harness/providers/index.js";
import { route } from "../harness/route/index.js";
import { envelopesMatch, matchesGolden, PARITY_QUESTION } from "./golden-envelope.js";
import { WARBLE_REPO } from "./warble-checkout.js";

/**
 * Opt-in LIVE cross-back-end parity: runs BOTH Mode A
 * (against a real, capable tool-calling model) and Mode B (against a real
 * Claude subscription) on {@link PARITY_QUESTION} over the `jaffle-wren`
 * sample project, and asserts both results `matchesGolden` AND match each
 * other. This is the only test that actually exercises both live back-ends
 * end-to-end — everything else in the suite is hermetic (item B covers
 * Mode A's output contract with the mock adapter; item C covers permission
 * enforcement directly).
 *
 * Skipped by default — enable by setting ALL of:
 *   - `WREN_TEST_LIVE_PARITY=1` (master opt-in switch)
 *   - `WREN_TEST_LIVE_MODEL=<model id>` (Mode A's model, e.g. a Claude or
 *     Ollama model id)
 *   - either `ANTHROPIC_API_KEY` (routes Mode A through the `anthropic`
 *     adapter, api-key mode) or `WREN_TEST_LIVE_MODEL_ENDPOINT` (routes
 *     Mode A through the `openai-compatible` adapter, local mode — e.g. a
 *     local Ollama endpoint)
 *
 * Mode B's "subscription available" signal reuses the harness's own
 * best-effort login probe (`createDefaultLoginProbe().claudeLoggedIn()`)
 * rather than a bespoke env var, since it already answers exactly this
 * question. `WREN_TEST_PROFILE_SOURCE`/`WREN_TEST_PROJECT` optionally
 * override the profile/project paths (the latter following the one
 * existing env-var convention in the suite, from `e2e-wren-native.test.ts`).
 *
 * This test is never run as part of `npm test` unless a human/orchestrator
 * deliberately sets the env vars above — it burns real API/subscription
 * usage.
 */

const PROFILE_SOURCE = process.env["WREN_TEST_PROFILE_SOURCE"] ?? path.join(WARBLE_REPO, "genbi-default");
const JAFFLE_WREN = process.env["WREN_TEST_PROJECT"] ?? path.join(WARBLE_REPO, "examples", "jaffle-wren");

const LIVE_PARITY_ENABLED = process.env["WREN_TEST_LIVE_PARITY"] === "1";
const LIVE_MODEL = process.env["WREN_TEST_LIVE_MODEL"];
const LIVE_MODEL_ENDPOINT = process.env["WREN_TEST_LIVE_MODEL_ENDPOINT"];
const LIVE_MODEL_API_KEY = process.env["ANTHROPIC_API_KEY"];

function isWrenOnPath(): boolean {
  try {
    execFileSync("wren", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function isWarbleAvailable(): Promise<boolean> {
  try {
    await resolveWarbleBinary();
    return true;
  } catch {
    return false;
  }
}

async function canRunLiveParity(): Promise<boolean> {
  if (!LIVE_PARITY_ENABLED) return false;
  if (!LIVE_MODEL) return false;
  if (!LIVE_MODEL_ENDPOINT && !LIVE_MODEL_API_KEY) return false;
  if (!existsSync(PROFILE_SOURCE) || !existsSync(JAFFLE_WREN)) return false;
  if (!isWrenOnPath()) return false;
  if (!(await isWarbleAvailable())) return false;
  return createDefaultLoginProbe().claudeLoggedIn();
}

const canRun = await canRunLiveParity();

/** Minimal test-only JSON-object extraction from Mode B's raw `finalText`; mirrors (without reusing, since it isn't exported) the tolerant extraction `harness/render/envelope.ts` does for Mode A's model text. */
function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to brace-scanning
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`could not find a JSON object in Mode B's finalText:\n${trimmed}`);
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}

describe.skipIf(!canRun)(
  "cross-back-end LIVE parity: Mode A vs Mode B [opt-in, real subscription + real model, never runs by default]",
  () => {
    it(
      "both back-ends answer the baseline question, each matchesGolden, and match each other",
      async () => {
        // `canRun` (checked above) already guarantees `LIVE_MODEL` is set before this test is
        // allowed to run at all — this is just narrowing that runtime fact for the type checker.
        if (LIVE_MODEL === undefined) throw new Error("WREN_TEST_LIVE_MODEL must be set to reach this point");
        const model = LIVE_MODEL;

        const authChoiceA: AuthChoice = LIVE_MODEL_ENDPOINT
          ? { mode: "local", endpoint: LIVE_MODEL_ENDPOINT }
          : {
              mode: "api-key",
              adapter: ANTHROPIC_ADAPTER_ID,
              config: LIVE_MODEL_API_KEY !== undefined ? { model, apiKey: LIVE_MODEL_API_KEY } : { model },
            };

        const modeAResult = await route({
          authChoice: authChoiceA,
          profileSource: PROFILE_SOURCE,
          userProject: JAFFLE_WREN,
          question: PARITY_QUESTION,
          model,
        });
        if (modeAResult.backend !== "agent" || modeAResult.kind !== "answer") {
          throw new Error(`Mode A did not return an answer: ${JSON.stringify(modeAResult)}`);
        }

        const authChoiceB: AuthChoice = { mode: "subscription", provider: "claude" };
        const modeBResult = await route({
          authChoice: authChoiceB,
          profileSource: PROFILE_SOURCE,
          userProject: JAFFLE_WREN,
          question: PARITY_QUESTION,
        });
        if (modeBResult.backend !== "agent-sdk") {
          throw new Error(`Mode B did not return the agent-sdk backend: ${JSON.stringify(modeBResult)}`);
        }

        const envelopeB = extractJsonObject(modeBResult.finalText);

        expect(matchesGolden(modeAResult.envelope)).toBe(true);
        expect(matchesGolden(envelopeB)).toBe(true);
        expect(envelopesMatch(modeAResult.envelope, envelopeB)).toBe(true);
      },
      120_000,
    );
  },
);
