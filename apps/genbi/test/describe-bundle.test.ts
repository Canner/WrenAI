import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AuthChoice } from "../harness/auth/index.js";
import { describeBundle } from "../harness/route/describe.js";
import { buildHarnessDto } from "../server/harness.js";
import { Store } from "../server/db.js";
import { WARBLE_REPO } from "./warble-checkout.js";

/** This package's own `profiles/` tree — the GenBI profiles now live here, not in a Warble checkout. */
const PROFILES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "profiles");

const PROFILE_SOURCE = path.join(PROFILES_DIR, "genbi-default");
const ENRICH_PROFILE_SOURCE = path.join(PROFILES_DIR, "genbi-enrich-context");
const JAFFLE_WREN = path.join(WARBLE_REPO, "examples", "jaffle-wren");
// Candidate override is explicit; manifests use the pinned installed SDK package.
const WARBLE_BIN = process.env.WARBLE_TEST_CLI ?? path.join(WARBLE_REPO, "target", "release", "warble");

const canRun =
  existsSync(PROFILE_SOURCE) &&
  existsSync(ENRICH_PROFILE_SOURCE) &&
  existsSync(JAFFLE_WREN) &&
  existsSync(WARBLE_BIN);

/**
 * Mirrors `runtimeDispatcher` (`server/harness.ts`) verbatim — that
 * function isn't exported (it's a private helper closed over `RouteOptions`),
 * so this restates its one-line predicate rather than reaching into the
 * server module for a single boolean. If the two ever drift, this comment is
 * the tripwire: keep them identical.
 */
function expectedDispatcher(authChoice: AuthChoice): "claude-agent-sdk" | "in-process" {
  return authChoice.mode === "subscription" ? "claude-agent-sdk" : "in-process";
}

describe.skipIf(!canRun)(
  "describeBundle sources the display from whichever back-end actually runs [opt-in integration]",
  () => {
    it("subscription authChoice (dispatched) sources the claude-agent-sdk manifest, agreeing with runtimeDispatcher", async () => {
      const authChoice: AuthChoice = { mode: "subscription", provider: "claude" };

      const bundle = await describeBundle({
        authChoice,
        profileSource: PROFILE_SOURCE,
        userProject: JAFFLE_WREN,
        warbleBin: WARBLE_BIN,
      });

      expect(bundle.target).toBe("claude-agent-sdk:local");
      expect(expectedDispatcher(authChoice)).toBe("claude-agent-sdk");
      // Loads via `loadBundle` inside `describeBundle` itself (throws on malformed shape) — the
      // manifest is structurally a `Bundle` even though it arrived via `manifest_version`, not
      // `vercel_bundle_version`.
      expect(bundle.profile).toBe("genbi-default");
      expect(bundle.agents.length).toBeGreaterThan(0);
    });

    it("api-key authChoice (in-process) sources the vercel bundle, agreeing with runtimeDispatcher's in-process prediction", async () => {
      const authChoice: AuthChoice = { mode: "api-key", adapter: "openai" };

      const bundle = await describeBundle({
        authChoice,
        profileSource: PROFILE_SOURCE,
        userProject: JAFFLE_WREN,
        warbleBin: WARBLE_BIN,
      });

      expect(bundle.target).toBe("vercel:headless");
      expect(expectedDispatcher(authChoice)).toBe("in-process");
      expect(bundle.profile).toBe("genbi-default");
    });

    it("promotes an enrichment component unavailable on the compiled dispatch target to ready via the native session, through the real manifest, loader, and DTO", async () => {
      const authChoice: AuthChoice = { mode: "subscription", provider: "claude" };
      const bundle = await describeBundle({
        authChoice,
        profileSource: ENRICH_PROFILE_SOURCE,
        userProject: JAFFLE_WREN,
        warbleBin: WARBLE_BIN,
      });

      // `describeBundle` runs the actual manifest command and validates its
      // JSON with `loadBundleWithProvenance` before this DTO mapping.
      // `apply_enrichment` is unavailable on the compiled programmatic
      // dispatch target (claude-agent-sdk:local) — but this purpose's native
      // session IS available, so the component actually runs
      // (via native CLI, not the programmatic path) and must be promoted to
      // "ready", qualified by the native target, rather than shown as
      // Unavailable at the wrong axis.
      const dto = buildHarnessDto(bundle, new Store(":memory:"), {
        authChoice,
        profileSource: ENRICH_PROFILE_SOURCE,
        userProject: JAFFLE_WREN,
      }, "context_enrichment", { purposes: { context_enrichment: { available: true, target: "claude-code:interactive", targetLabel: "Claude CLI" } } } as never);
      expect(dto.components.find((component) => component.id === "inspect_context")?.status).toBe("ready");
      expect(dto.components.find((component) => component.id === "draft_enrichment")?.status).toBe("ready");
      expect(dto.components.find((component) => component.id === "apply_enrichment")).toMatchObject({
        status: "ready",
        model: "—",
        tiers: [],
        capabilities: [],
        guardrails: [],
        tools: [],
        outputBlocks: [],
        steps: [],
        nativeAvailability: {
          viaLabel: "Claude CLI",
          compiledDispatchTarget: "claude-agent-sdk:local",
          compiledUnavailableReason: "component is unavailable on the configured runtime",
        },
      });
    });
  },
);
