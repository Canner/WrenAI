import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDefaultLoginProbe, type AuthChoice } from "../harness/auth/index.js";
import { resolveWarbleBinary } from "../harness/compile/resolve-binary.js";
import { ANTHROPIC_ADAPTER_ID, OPENAI_COMPATIBLE_ADAPTER_ID } from "../harness/providers/index.js";
import type { AdapterSpec } from "../harness/providers/index.js";
import { route } from "../harness/route/index.js";
import { WARBLE_REPO } from "./warble-checkout.js";

/**
 * Opt-in LIVE "hybrid" tests: one Mode A case (a non-uniform
 * `tierBinding` splitting `cheap`/`strong` across two real providers) and one
 * Mode B case (`--models-config` passthrough to a real `warble-agent-sdk
 * chat` invocation). Mirrors `e2e-cross-backend-parity.test.ts`'s gating
 * style — SKIPPED by default; nothing here runs as part of `npm test`
 * unless a human/orchestrator deliberately sets every env var a given case
 * requires. Neither case was run while writing this file.
 *
 * Known limitations inherited from warble's own hybrid holes (tracked
 * upstream, not fixed by this harness): the render stage wall-hits on any
 * non-`render: none` component under a non-Anthropic tier (the Mode B case
 * below sticks to `answer_query`, which *does* render, so it is expected to
 * surface this if warble's hole is still open), the `openai_compat` local
 * client has no streaming/retry, and net cost savings are unproven. Weak
 * local models are also known to call tools unreliably — a model-quality
 * issue, not a wiring bug either mode introduces.
 *
 * Master switch: `WREN_TEST_LIVE_HYBRID=1`.
 *
 * Mode A hybrid case additionally requires:
 *   - `WREN_TEST_HYBRID_CHEAP_ENDPOINT` (a real OpenAI-compatible endpoint,
 *     e.g. a local Ollama server, bound to the `cheap` tier)
 *   - `WREN_TEST_HYBRID_CHEAP_MODEL` (the model id served there)
 *   - `ANTHROPIC_API_KEY` (bound to the `strong` tier via the `anthropic`
 *     adapter)
 *
 * Mode B hybrid case additionally requires:
 *   - `WREN_TEST_HYBRID_MODELS_CONFIG` (path to a warble `ModelConfig` YAML
 *     — see `dispatcher/claude-agent-sdk/src/models.ts` for the shape)
 *   - a logged-in `claude` subscription CLI (checked the same way
 *     `e2e-cross-backend-parity.test.ts` does)
 *
 * `WREN_TEST_PROFILE_SOURCE`/`WREN_TEST_PROJECT` optionally override the
 * profile/project paths, matching the existing suite-wide convention.
 */

const PROFILE_SOURCE = process.env["WREN_TEST_PROFILE_SOURCE"] ?? path.join(WARBLE_REPO, "genbi-default");
const JAFFLE_WREN = process.env["WREN_TEST_PROJECT"] ?? path.join(WARBLE_REPO, "examples", "jaffle-wren");

const LIVE_HYBRID_ENABLED = process.env["WREN_TEST_LIVE_HYBRID"] === "1";
const HYBRID_CHEAP_ENDPOINT = process.env["WREN_TEST_HYBRID_CHEAP_ENDPOINT"];
const HYBRID_CHEAP_MODEL = process.env["WREN_TEST_HYBRID_CHEAP_MODEL"];
const HYBRID_STRONG_API_KEY = process.env["ANTHROPIC_API_KEY"];
const HYBRID_MODELS_CONFIG = process.env["WREN_TEST_HYBRID_MODELS_CONFIG"];

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

async function commonPrereqsOk(): Promise<boolean> {
  if (!LIVE_HYBRID_ENABLED) return false;
  if (!existsSync(PROFILE_SOURCE) || !existsSync(JAFFLE_WREN)) return false;
  if (!isWrenOnPath()) return false;
  return isWarbleAvailable();
}

async function canRunModeAHybrid(): Promise<boolean> {
  if (!(await commonPrereqsOk())) return false;
  if (!HYBRID_CHEAP_ENDPOINT || !HYBRID_CHEAP_MODEL || !HYBRID_STRONG_API_KEY) return false;
  return true;
}

async function canRunModeBHybrid(): Promise<boolean> {
  if (!(await commonPrereqsOk())) return false;
  if (!HYBRID_MODELS_CONFIG || !existsSync(HYBRID_MODELS_CONFIG)) return false;
  return createDefaultLoginProbe().claudeLoggedIn();
}

const canRunA = await canRunModeAHybrid();
const canRunB = await canRunModeBHybrid();

describe.skipIf(!canRunA)(
  "hybrid Mode A LIVE: cheap tier on a local endpoint, strong tier on Anthropic [opt-in, real calls, never runs by default]",
  () => {
    it(
      "answers the baseline question, splitting resolve_intent (cheap) from generate_sql/render (strong) across two real providers",
      async () => {
        if (HYBRID_CHEAP_ENDPOINT === undefined || HYBRID_CHEAP_MODEL === undefined || HYBRID_STRONG_API_KEY === undefined) {
          throw new Error("canRunModeAHybrid() already guarantees these are set — narrowing for the type checker");
        }

        const tierBinding: Record<string, AdapterSpec> = {
          cheap: {
            adapter: OPENAI_COMPATIBLE_ADAPTER_ID,
            config: { baseURL: HYBRID_CHEAP_ENDPOINT, model: HYBRID_CHEAP_MODEL },
          },
          strong: {
            adapter: ANTHROPIC_ADAPTER_ID,
            config: { apiKey: HYBRID_STRONG_API_KEY },
          },
        };

        const authChoice: AuthChoice = { mode: "local", endpoint: HYBRID_CHEAP_ENDPOINT };

        const result = await route({
          authChoice,
          profileSource: PROFILE_SOURCE,
          userProject: JAFFLE_WREN,
          question: "who is our top customer?",
          tierBinding,
        });

        if (result.backend !== "agent") throw new Error(`expected the agent backend (Mode A), got: ${JSON.stringify(result)}`);
        expect(result.kind).toBe("answer");
      },
      120_000,
    );
  },
);

describe.skipIf(!canRunB)(
  "hybrid Mode B LIVE: --models-config passthrough to warble-agent-sdk chat [opt-in, real subscription, never runs by default]",
  () => {
    it(
      "answers the baseline question with one step routed onto a non-Anthropic model via warble's own ModelConfig",
      async () => {
        if (HYBRID_MODELS_CONFIG === undefined) {
          throw new Error("canRunModeBHybrid() already guarantees this is set — narrowing for the type checker");
        }

        const authChoice: AuthChoice = { mode: "subscription", provider: "claude" };

        const result = await route({
          authChoice,
          profileSource: PROFILE_SOURCE,
          userProject: JAFFLE_WREN,
          question: "who is our top customer?",
          modelsConfig: HYBRID_MODELS_CONFIG,
        });

        if (result.backend !== "agent-sdk") throw new Error(`expected the agent-sdk backend (Mode B), got: ${JSON.stringify(result)}`);
        expect(result.finalText.length).toBeGreaterThan(0);
      },
      120_000,
    );
  },
);
