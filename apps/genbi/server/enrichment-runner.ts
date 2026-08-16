/**
 * Real (non-mock) `EnrichmentRunner` implementation for the draft path.
 *
 * Dispatches warble's `genbi-enrich-context` profile — `inspect_context`
 * then `draft_enrichment` — via Mode B (the Claude Agent SDK dispatcher),
 * one subprocess per component. `warble-agent-sdk chat` is a single
 * line-per-turn stdin protocol (see `harness/route/mode-b.ts`'s
 * `spawnChat`/`buildAgentSdkChatArgs`), so a two-component flow is two
 * separate dispatches: this module folds turn 1's finalText into turn 2's
 * composed question itself — there is no SDK-level session chaining that
 * could do this for us within one `draft()` call.
 *
 * Translation, not policy. `server/enrichment.ts`'s `canonicalizeProposal`
 * is the only place a draft becomes a trusted `EnrichmentProposal`: it
 * ignores any `id`/`hash`/`projectRevision`/`risk` the model supplies and
 * independently recomputes them. This module's `translateDraftTerminal`
 * adds a second, independent layer of the same discipline by construction:
 * it copies over only five named fields (`sink`, `changeKind`, `summary`,
 * `draft`, `confidence`) from the model's parsed JSON, so a forged
 * `hash`/`id`/`risk`/`projectRevision` the model includes never even
 * reaches `canonicalizeProposal` in the first place.
 *
 * Vocabulary seam: warble's `draft_enrichment` component (steps/draft.md)
 * only ever describes the operation envelope in prose — `relative_sink`,
 * `recommended_yaml`, confidence/evidence — and is silent on a literal
 * `changeKind`/`summary` field, because those are GenBI-host vocabulary
 * (`EnrichmentChangeKind`), not something warble's own contract shares with
 * the model. `composeDraftPrompt` below is where that gap is closed: it
 * layers an additional host-owned instruction on top of the dispatched
 * component's own step prompt, exactly the way `server/compose.ts`'s
 * `composeSetupPrompt` layers its own `SETUP_STATUS: ok|needs_input|error`
 * terminal convention on top of `connect_source`, "since warble's
 * `connect_source` component carries no terminal-status convention of its
 * own." Neither wrapper prompt edits or contradicts the dispatched
 * component's own instructions.
 */
import type { AgentEvent, AuthChoice } from "../harness/index.js";
import { resolveDefaultEnrichIrPath, runModeBDefault } from "../harness/index.js";
import { EnrichmentContractError, type EnrichmentMode, type EnrichmentRunner, type EnrichmentRunnerReadiness } from "./enrichment.js";

/**
 * The one live refusal condition `readiness()` and `defaultDispatch` share --
 * this dispatch path only ever talks to Claude via Mode B, so anything else
 * is a refusal, not a routing choice. Kept as a single function so the two
 * call sites (the readiness check below, and `defaultDispatch`'s own guard)
 * can never drift apart from each other; the reason code is also exactly
 * what `readiness()` hands to the host route, which forwards it verbatim.
 */
const REQUIRES_CLAUDE_SUBSCRIPTION = "requires_claude_subscription";

/**
 * A type guard (not just a boolean) so `defaultDispatch`'s own guard clause
 * keeps narrowing `authChoice` to what `runModeBDefault` requires -- the
 * single source of truth `draftAuthReadiness` and `defaultDispatch` both
 * call, so the two can never drift apart.
 */
function isClaudeSubscriptionAuth(authChoice: AuthChoice): authChoice is AuthChoice & { mode: "subscription"; provider: "claude" } {
  return authChoice.mode === "subscription" && authChoice.provider === "claude";
}

function draftAuthReadiness(authChoice: AuthChoice): EnrichmentRunnerReadiness {
  return isClaudeSubscriptionAuth(authChoice) ? { available: true } : { available: false, reason: REQUIRES_CLAUDE_SUBSCRIPTION };
}

export const INSPECT_CONTEXT_AGENT_ID = "inspect_context";
export const DRAFT_ENRICHMENT_AGENT_ID = "draft_enrichment";

/** One Mode B turn: an `agentId` (warble component) + composed `question`, against a bound project. */
export interface EnrichmentDispatchInput {
  readonly agentId: string;
  readonly question: string;
  readonly userProject: string;
}
export interface EnrichmentDispatchResult {
  readonly finalText: string;
}
/** Test-only seam: replaces the two real Mode B subprocess dispatches. Never set in production. */
export type EnrichmentDispatch = (input: EnrichmentDispatchInput) => Promise<EnrichmentDispatchResult>;

export interface ModeBEnrichmentDraftRunnerOptions {
  /**
   * Live auth-choice read, not a value frozen at construction. `EnrichmentRunner.draft()`
   * (`server/enrichment.ts`) takes no `authChoice` parameter of its own — unlike
   * `SetupStepRunner.run()`, which does — so this is this module's own seam for staying current
   * with a later `PUT /api/config/runtime` rebind (`server/turn.ts`'s `TurnDeps.getAuthChoice`)
   * instead of dispatching every future draft call against whatever auth choice happened to be
   * active when `server/bin.ts` constructed this runner at boot.
   */
  readonly getAuthChoice: () => AuthChoice;
  /** Defaults to `resolveDefaultEnrichIrPath()` (the committed `warble/genbi-enrich-context/ir.golden.json`). */
  readonly irPath?: string;
  readonly warbleBin?: string;
  readonly agentSdkBin?: string;
  readonly outDir?: string;
  /**
   * Mirrors `ModeBSetupRunnerOptions.getModelsConfig` — a live read, not a value frozen at
   * construction, so a later `PUT /api/config/runtime` rebind is picked up by the next draft
   * call instead of requiring a process restart.
   */
  /**
   * Directory of the genbi-enrich-context profile. When set, the draft is
   * dispatched from an IR compiled against the bound project — which is the
   * only way the agent's injected context describes the project it is about to
   * propose changes to.
   *
   * Without it the runner falls back to `irPath`, a prebuilt IR. That is how
   * this ran until now, and the prebuilt IR available to it was the profile's
   * eval golden: the profile compiled against warble's own example project,
   * with jaffle-shop's models baked into `context_binding.resolved`. A live
   * draft duly analysed gaps in someone else's schema.
   */
  readonly profileSource?: string;
  readonly getModelsConfig?: () => string | undefined;
  readonly chatTimeoutMs?: number;
  readonly maxTurns?: number;
  readonly onEvent?: (event: AgentEvent) => void;
  /** Test-only seam. See `EnrichmentDispatch`. Never set in production wiring (`server/bin.ts`). */
  readonly dispatch?: EnrichmentDispatch;
}

/**
 * Which profile input `runModeBDefault` is given, and whether it is allowed to
 * skip compilation.
 *
 * Passing `irPath` short-circuits `compileProfile`, which is how a prebuilt
 * golden — the profile compiled against warble's own example project — used to
 * reach the agent. With a profile source we want the opposite: compile, so the
 * dispatched IR's context is the bound project's.
 *
 * Exported because that branch is the whole point of the fix and is otherwise
 * only reachable through a real dispatch.
 */
export function draftProfileInput(profileSource: string | undefined, irPath: string): { profileSource: string; irPath?: string } {
  return profileSource === undefined ? { profileSource: irPath, irPath } : { profileSource };
}

function defaultDispatch(options: ModeBEnrichmentDraftRunnerOptions): EnrichmentDispatch {
  return async ({ agentId, question, userProject }) => {
    const irPath = options.irPath ?? resolveDefaultEnrichIrPath();
    if (irPath === undefined) {
      throw new EnrichmentContractError(
        "no genbi-enrich-context IR found (searched ancestors for a sibling warble checkout); " +
          "pass an explicit irPath or check out warble as a sibling repo",
      );
    }
    const authChoice = options.getAuthChoice();
    if (!isClaudeSubscriptionAuth(authChoice)) {
      throw new EnrichmentContractError(
        `enrichment draft dispatch requires Claude subscription auth, got mode "${authChoice.mode}"` +
          (authChoice.mode === "subscription" ? ` provider "${authChoice.provider}"` : ""),
      );
    }
    const modelsConfig = options.getModelsConfig?.();
    const result = await runModeBDefault({
      authChoice,
      ...draftProfileInput(options.profileSource, irPath),
      userProject,
      question,
      agentId,
      ...(options.warbleBin !== undefined ? { warbleBin: options.warbleBin } : {}),
      ...(options.agentSdkBin !== undefined ? { agentSdkBin: options.agentSdkBin } : {}),
      ...(options.outDir !== undefined ? { outDir: options.outDir } : {}),
      ...(modelsConfig !== undefined ? { modelsConfig } : {}),
      ...(options.chatTimeoutMs !== undefined ? { chatTimeoutMs: options.chatTimeoutMs } : {}),
      ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
      ...(options.onEvent !== undefined ? { onEvent: options.onEvent } : {}),
    });
    return { finalText: result.finalText };
  };
}

/**
 * `inspect_context` has no formal params and no dynamic per-run content to
 * restate (unlike Setup's `connect`/`context` steps, which restate a
 * project name / source type the warble component has no other way to
 * learn). The only thing this run-specific wrapper needs to convey is the
 * mode, because `steps/inspect.md` itself makes probe permission mode
 * dependent ("In grill mode, live database probes are allowed only after
 * the host records the user's one-time consent; in autopilot they are
 * forbidden"). This host does not yet implement a consent-recording
 * mechanism, so it must say so honestly rather than silently imply consent
 * was granted — asserting an unrecorded consent is exactly the kind of
 * disprovable claim this codebase has been burned by before.
 */
export function composeInspectPrompt(mode: EnrichmentMode): string {
  const probeRule =
    mode === "grill"
      ? "No one-time database-probe consent has been recorded for this run, so do not perform any live database probe — rely only on already-materialized MDL, cube, knowledge, and NL-to-SQL content."
      : "Autopilot mode: live database probes are forbidden — rely only on already-materialized MDL, cube, knowledge, and NL-to-SQL content.";
  return `Begin the enrichment inventory now. Run mode is "${mode}". ${probeRule} Produce the enrichment_gaps inventory exactly as instructed.`;
}

/**
 * Layers two host-owned requirements on top of `draft_enrichment`'s own
 * `steps/draft.md` instructions, which never contradict: (1) the pinned
 * project revision this run is locked to, restated so the model treats it
 * as input rather than inferring one of its own (draft.md already demands
 * this, this just supplies the concrete value); (2) a `changeKind` and a
 * `summary` field on every operation — vocabulary the host's own
 * `EnrichmentChangeKind` type needs to classify and route the sink, that
 * warble's component prose never names. Everything else (field names for
 * the sink/body themselves, the single-operation-plus-decision shape for
 * grill, the cube schema, the append-only/no-overwrite rules) is exactly
 * what draft.md already tells the model — restating it here would be
 * redundant, not additive.
 */
export function composeDraftPrompt(mode: EnrichmentMode, projectRevision: string, gapInventory: string): string {
  const changeKinds = "knowledge_append, new_cube, new_view, new_relationship, mdl_metric, calculated_column, conflict, ambiguous";
  return (
    `Draft the enrichment proposal now for project revision "${projectRevision}", run mode "${mode}". ` +
    `In addition to the fields your own instructions already describe, every operation object must also carry ` +
    `a "changeKind" field set to exactly one of: ${changeKinds}; and a "summary" field: a short, one-line, ` +
    `human-readable description of the change with no raw excerpts or credentials. Do not invent or claim a ` +
    `hash, digest, id, or risk label for any operation — the host computes and independently verifies all of ` +
    `those and will discard any you include. Gap inventory from the inspection step:\n${gapInventory}`
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/**
 * Parses the model's bare-JSON final message. draft.md's instruction is
 * unambiguous ("Your FINAL message must be one JSON object only. Do not
 * include prose or Markdown fences"), and the compiled golden the runtime
 * actually dispatches matches it byte for byte -- so a fenced terminal is
 * model variance, not prompt drift, and the durable fix is host-side
 * tolerance, not a prompt rewrite (see
 * `test/draft-enrichment-fenced-terminal.integration.test.ts`, pinned
 * against a real recorded run whose terminal was prose followed by a
 * ```json fenced block).
 *
 * The fence match is intentionally NOT anchored to the whole trimmed
 * string, so a fence preceded (or followed) by prose is tolerated the same
 * as a bare fence or no fence at all. This duplicates the fence-matching
 * approach `harness/render/envelope.ts`'s `extractJsonObjectText` already
 * uses for the unrelated answer-rendering path, rather than importing that
 * function directly: it is private to that module, and its extra
 * brace-scanning fallback (for free-form, unfenced prose) is machinery this
 * caller doesn't need -- a bare JSON terminal here already round-trips
 * through `JSON.parse` below with no fence at all.
 */
export function parseDraftTerminalJson(finalText: string): unknown {
  let text = finalText.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(text);
  if (fenced?.[1] !== undefined) text = fenced[1].trim();
  try {
    return JSON.parse(text);
  } catch {
    throw new EnrichmentContractError("draft turn did not return a parseable JSON terminal");
  }
}

/**
 * Normalizes warble's model-facing terminal shape (`{ enrichment_proposal:
 * {...} }`, a single operation directly under `enrichment_proposal` for
 * grill per draft.md's spec, or an `operations` array for a multi-operation
 * flow) into the shape `canonicalizeProposal` (server/enrichment.ts)
 * accepts: `{ operations: [{ sink, changeKind, summary, draft, confidence
 * }] }`. Copies over ONLY those five fields, by name, from whichever of the
 * model's own field names (`relative_sink`/`recommended_yaml`, this
 * module's added `changeKind`/`summary`) or the host's own names
 * (`sink`/`draft`) the model actually used — so a forged `hash`, `id`,
 * `projectRevision`, or `risk` the model includes anywhere in its JSON is
 * silently dropped here and never reaches `canonicalizeProposal` at all.
 */
export function translateDraftTerminal(finalText: string): unknown {
  const parsed = parseDraftTerminalJson(finalText);
  const root = record(parsed);
  const proposal = root ? record(root["enrichment_proposal"]) : undefined;
  if (!proposal) throw new EnrichmentContractError("draft turn's terminal did not contain an enrichment_proposal object");
  const rawOperations: readonly unknown[] = Array.isArray(proposal["operations"]) ? (proposal["operations"] as readonly unknown[]) : [proposal];
  const operations = rawOperations.map((rawOperation) => {
    const op = record(rawOperation) ?? {};
    return {
      sink: op["sink"] ?? op["relative_sink"],
      changeKind: op["changeKind"] ?? op["change_kind"],
      summary: op["summary"],
      draft: op["draft"] ?? op["recommended_yaml"],
      confidence: op["confidence"],
    };
  });
  return { operations };
}

/**
 * Builds the real, production `EnrichmentRunner.draft()`: two Mode B
 * dispatches (`inspect_context` then `draft_enrichment`) against the bound
 * project, folding turn 1's output into turn 2's composed question, then
 * translating the terminal into the shape the host's own
 * `canonicalizeProposal` independently validates and hashes. Returns
 * `unknown`, exactly like the interface requires — this function never
 * calls `canonicalizeProposal` itself; that stays the caller's (the `/api/
 * context/enrichment/*` route's) job, same as every mock runner in
 * `test/bff-enrichment.test.ts`.
 */
export function createModeBEnrichmentDraftRunner(options: ModeBEnrichmentDraftRunnerOptions): EnrichmentRunner {
  const dispatch = options.dispatch ?? defaultDispatch(options);
  return {
    async draft(input): Promise<unknown> {
      const inspectResult = await dispatch({
        agentId: INSPECT_CONTEXT_AGENT_ID,
        question: composeInspectPrompt(input.mode),
        userProject: input.projectPath,
      });
      const draftResult = await dispatch({
        agentId: DRAFT_ENRICHMENT_AGENT_ID,
        question: composeDraftPrompt(input.mode, input.projectRevision, inspectResult.finalText),
        userProject: input.projectPath,
      });
      return translateDraftTerminal(draftResult.finalText);
    },
    // Pure read of the live auth choice -- no dispatch, no cost, no side effect.
    readiness(): EnrichmentRunnerReadiness {
      return draftAuthReadiness(options.getAuthChoice());
    },
  };
}
