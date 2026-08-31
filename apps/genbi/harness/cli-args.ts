import { detectAndPick } from "./auth/index.js";
import type { AuthChoice, LoginProbe } from "./auth/index.js";
import type { Deployment } from "./compliance/index.js";
import type { AdapterSpec } from "./providers/index.js";
import { deriveAdapterSpec } from "./route/adapter-spec.js";
import type { RouteResult } from "./route/types.js";

/**
 * Parsed CLI flags after normalization. Kept separate from `node:util`'s
 * `parseArgs` inferred type so these pure helpers can be unit-tested with
 * plain objects, and so `exactOptionalPropertyTypes` is satisfied (optional
 * fields are omitted, never set to `undefined`).
 */
export interface CliFlags {
  readonly project?: string;
  readonly profile?: string;
  readonly mode?: string;
  readonly provider?: string;
  readonly adapter?: string;
  readonly apiKey?: string;
  readonly model?: string;
  readonly endpoint?: string;
  readonly warbleBin?: string;
  readonly agentSdkBin?: string;
  readonly out?: string;
  readonly deployment?: string;
  /** Hybrid mode, in-process: repeatable `--tier-adapter <tier>=<mode>[:<field>=<value>,...]` entries. */
  readonly tierAdapters?: readonly string[];
  /** Hybrid mode, dispatched: `--models-config <path>`, forwarded verbatim to `warble-agent-sdk chat`. */
  readonly modelsConfig?: string;
  /** Dispatched only: `--chat-timeout-ms <n>`, overrides `spawnChat`'s default 10-minute hang guard. See `DispatchedOptions.chatTimeoutMs`. */
  readonly chatTimeoutMs?: number;
}

/** Thrown for user-facing CLI misuse (bad/missing flags), surfaced as a top-level `error:` line. */
export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

/** Validates the required `--project` and positional question, rejecting empty/whitespace-only values. */
export function validateRequiredInputs(project: string | undefined, question: string): string {
  if (project === undefined || isBlank(project)) {
    throw new CliUsageError("--project <dir> is required and must not be empty");
  }
  if (isBlank(question)) {
    throw new CliUsageError("a non-empty question is required");
  }
  return project;
}

/**
 * Resolves `--deployment`, defaulting to `"personal"` and rejecting any
 * value other than `"personal"`/`"hosted"`. Kept separate from
 * `enforceCompliance` so the CLI's flag validation (bad flag value) and the
 * compliance gate's policy decision (which flag values imply what) stay two
 * independently testable pure functions, matching `validateRequiredInputs`.
 */
export function resolveDeployment(flags: CliFlags): Deployment {
  const value = flags.deployment ?? "personal";
  if (value !== "personal" && value !== "hosted") {
    throw new CliUsageError(`--deployment must be "personal" or "hosted", got "${value}"`);
  }
  return value;
}

/**
 * Parses `--chat-timeout-ms`'s raw string value into a positive integer,
 * rejecting anything else (blank, non-numeric, zero/negative, non-integer)
 * as a CLI usage error rather than silently passing `NaN`/0 down to
 * `spawnChat`'s `setTimeout`. Returns `undefined` when the flag was omitted.
 */
export function parseChatTimeoutMs(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new CliUsageError(`--chat-timeout-ms must be a positive integer (milliseconds), got "${raw}"`);
  }
  return value;
}

/**
 * Parses `WREN_HARNESS_SETUP_MAX_TURNS` (the agentic setup wizard's per-turn
 * agent-loop budget, forwarded as `warble-agent-sdk chat --max-turns`) into a
 * positive integer, rejecting anything else rather than silently passing
 * `NaN`/0 down. Returns `undefined` when unset, so the setup runner's own
 * default applies. The heavy step is `build_context` (generating an MDL takes
 * many read/introspect/write/validate tool calls), which routinely exceeds the
 * dispatcher's default 40-turn cap and fails with `error_max_turns`.
 */
export function parseSetupMaxTurns(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  // `/^\d+$/` before Number() so hex/float/whitespace-padded spellings
  // ("0x10", "1e3", " 40 ") are rejected rather than silently coerced.
  const value = /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  if (!Number.isInteger(value) || value <= 0) {
    throw new CliUsageError(`WREN_HARNESS_SETUP_MAX_TURNS must be a positive integer, got "${raw}"`);
  }
  return value;
}

/**
 * Default auth-selection policy when `--mode` is omitted: prefer an
 * explicitly-configured `api-key` (`--adapter`) or `local` (`--endpoint`)
 * choice — since the operator clearly meant one of those — over
 * auto-detection; otherwise enumerate options via `detectAndPick(probe)` and
 * pick a detected logged-in subscription CLI (claude, then codex); otherwise
 * fail loudly rather than silently guess a mode with no supporting evidence.
 * The `probe` is injected so the subscription-detection branch is testable
 * offline; `main()` passes `createDefaultLoginProbe()`.
 */
export async function resolveAuthChoice(flags: CliFlags, probe: LoginProbe): Promise<AuthChoice> {
  if (flags.mode !== undefined) {
    return buildExplicitAuthChoice(flags.mode, flags);
  }

  if (flags.adapter !== undefined) {
    const config = buildApiKeyConfig(flags);
    return { mode: "api-key", adapter: flags.adapter, ...(config !== undefined ? { config } : {}) };
  }
  if (flags.endpoint !== undefined) {
    return { mode: "local", endpoint: flags.endpoint };
  }

  // `--api-key`/`--model` without `--adapter` and without an explicit
  // `--mode` used to fall straight through to subscription auto-detection
  // below — silently discarding credentials the operator clearly configured
  // for a *different* mode and answering via whatever subscription CLI
  // happens to be logged in instead. Loud-fail instead of guessing an
  // adapter or silently picking subscription.
  if (flags.apiKey !== undefined || flags.model !== undefined) {
    throw new CliUsageError(
      "--api-key/--model given without --adapter <name> and without an explicit --mode; " +
        "pass --adapter <name> (to use api-key mode) or set --mode explicitly — refusing to " +
        "silently fall back to subscription auto-detection with credentials configured for a " +
        "different mode",
    );
  }

  const options = await detectAndPick(probe);
  const subscription = options.find(
    (option): option is Extract<typeof option, { mode: "subscription" }> => option.mode === "subscription",
  );
  if (subscription !== undefined) {
    return { mode: "subscription", provider: subscription.provider };
  }

  throw new CliUsageError(
    "no --mode given, no explicit --adapter/--endpoint configured, and no subscription CLI " +
      "(claude or codex) detected as logged in; pass --mode explicitly " +
      "(subscription|api-key|local|gateway)",
  );
}

/** Builds an `AuthChoice` for an explicit `--mode`, validating the flags each mode requires. */
export function buildExplicitAuthChoice(mode: string, flags: CliFlags): AuthChoice {
  switch (mode) {
    case "subscription": {
      const provider = flags.provider ?? "claude";
      if (provider !== "claude" && provider !== "codex") {
        throw new CliUsageError(`--provider must be "claude" or "codex", got "${provider}"`);
      }
      return { mode: "subscription", provider };
    }
    case "api-key": {
      if (flags.adapter === undefined) {
        throw new CliUsageError("--mode api-key requires --adapter <name>");
      }
      const config = buildApiKeyConfig(flags);
      return { mode: "api-key", adapter: flags.adapter, ...(config !== undefined ? { config } : {}) };
    }
    case "local":
      return { mode: "local", ...(flags.endpoint !== undefined ? { endpoint: flags.endpoint } : {}) };
    case "gateway": {
      const config = buildGatewayConfig(flags);
      return { mode: "gateway", ...(config !== undefined ? { config } : {}) };
    }
    default:
      throw new CliUsageError(`--mode must be one of subscription|api-key|local|gateway, got "${mode}"`);
  }
}

/** Exit code contract for the packaged `bin`: 0 = answered, 1 = error (unhandled throw), 2 = refusal. */
export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_REFUSAL = 2;

/**
 * A `RouteResult` with `kind: "refusal"` (in-process only — the agent
 * declined to answer because a `locked` `gated_check` guardrail wasn't
 * satisfied) is a completed *run*, not a crash, but it is also not an
 * answer; a shell/pipeline consumer of the packaged `bin` piping the CLI's
 * stdout needs a way to tell "ran but refused" (`EXIT_REFUSAL`) apart from
 * both "answered" (`EXIT_OK`) and "failed to run" (`EXIT_ERROR`, the
 * top-level `main().catch()` in `cli.ts`). Dispatched has no refusal state of
 * its own to map here — `runDispatchedDefault` throws (in `dispatched.ts`) on
 * an empty final answer rather than returning a refusal-shaped result, so
 * that already lands on `EXIT_ERROR` via the same top-level catch.
 */
export function determineExitCode(result: RouteResult): number {
  return "kind" in result && result.kind === "refusal" ? EXIT_REFUSAL : EXIT_OK;
}

/** api-key config from `--api-key`/`--model`; `undefined` when neither is set (so the adapter's own env lookup applies). */
export function buildApiKeyConfig(flags: CliFlags): Record<string, unknown> | undefined {
  const config: Record<string, unknown> = {};
  if (flags.apiKey !== undefined) config["apiKey"] = flags.apiKey;
  if (flags.model !== undefined) config["model"] = flags.model;
  return Object.keys(config).length > 0 ? config : undefined;
}

/** gateway config from `--endpoint`/`--model`/`--api-key`; `undefined` when none are set (so `deriveAdapterSpec` loud-fails). */
export function buildGatewayConfig(flags: CliFlags): Record<string, unknown> | undefined {
  const config: Record<string, unknown> = {};
  if (flags.endpoint !== undefined) config["baseURL"] = flags.endpoint;
  if (flags.model !== undefined) config["model"] = flags.model;
  if (flags.apiKey !== undefined) config["apiKey"] = flags.apiKey;
  return Object.keys(config).length > 0 ? config : undefined;
}

/** One parsed `--tier-adapter` entry, before it's turned into an `AdapterSpec`. */
interface ParsedTierAdapterFlag {
  readonly tier: string;
  readonly mode: string;
  readonly fields: Pick<CliFlags, "adapter" | "apiKey" | "model" | "endpoint">;
}

const TIER_ADAPTER_ALLOWED_MODES = new Set(["api-key", "local", "gateway"]);
const TIER_ADAPTER_ALLOWED_FIELDS = new Set(["adapter", "apiKey", "model", "endpoint"]);

/**
 * Parses one hybrid-mode `--tier-adapter <tier>=<mode>[:<field>=<value>,...]`
 * entry — e.g. `cheap=local:endpoint=http://localhost:11434/v1,model=llama3.1`
 * or `strong=api-key:adapter=anthropic,model=claude-opus-4-6`. `mode` is
 * restricted to `api-key`/`local`/`gateway` — subscription has no adapter of
 * its own (dispatched is the whole-run back-end, never a per-tier one), so
 * naming it here is a loud-fail rather than a silent no-op.
 */
export function parseTierAdapterFlag(raw: string): ParsedTierAdapterFlag {
  const tierEnd = raw.indexOf("=");
  if (tierEnd <= 0) {
    throw new CliUsageError(
      `--tier-adapter must be "<tier>=<mode>[:<field>=<value>,...]", got "${raw}"`,
    );
  }
  const tier = raw.slice(0, tierEnd);
  const rest = raw.slice(tierEnd + 1);
  const fieldsStart = rest.indexOf(":");
  const mode = fieldsStart === -1 ? rest : rest.slice(0, fieldsStart);
  const fieldsRaw = fieldsStart === -1 ? "" : rest.slice(fieldsStart + 1);

  if (!TIER_ADAPTER_ALLOWED_MODES.has(mode)) {
    throw new CliUsageError(
      `--tier-adapter "${raw}": mode must be one of api-key|local|gateway (a hybrid tier has no ` +
        `subscription adapter of its own), got "${mode}"`,
    );
  }

  const fields: Record<string, string> = {};
  if (fieldsRaw.length > 0) {
    for (const pair of fieldsRaw.split(",")) {
      const pairEq = pair.indexOf("=");
      if (pairEq <= 0) {
        throw new CliUsageError(`--tier-adapter "${raw}": malformed field "${pair}", expected key=value`);
      }
      const key = pair.slice(0, pairEq);
      if (!TIER_ADAPTER_ALLOWED_FIELDS.has(key)) {
        throw new CliUsageError(
          `--tier-adapter "${raw}": unknown field "${key}" (allowed: adapter, apiKey, model, endpoint)`,
        );
      }
      fields[key] = pair.slice(pairEq + 1);
    }
  }

  return { tier, mode, fields };
}

/**
 * Builds the hybrid-mode per-tier `AdapterSpec` map from every `--tier-adapter`
 * flag the CLI collected. Each entry is parsed with {@link parseTierAdapterFlag},
 * turned into an `AuthChoice` by reusing {@link buildExplicitAuthChoice} (so a
 * per-tier `api-key`/`local`/`gateway` entry validates exactly like the
 * top-level `--mode` flag does — e.g. `api-key` still requires `adapter=`),
 * and then resolved to an `AdapterSpec` via `deriveAdapterSpec`. Coverage
 * against the compiled agent's actual tiers (missing/unknown tier names) is
 * `buildHybridTierBinding`'s job at run time — this function only turns argv
 * into a map, without knowing what tiers the agent uses.
 */
export function buildTierBindingFromFlags(raw: readonly string[]): Record<string, AdapterSpec> {
  const tiers: Record<string, AdapterSpec> = {};
  for (const entry of raw) {
    const { tier, mode, fields } = parseTierAdapterFlag(entry);
    if (tier in tiers) {
      throw new CliUsageError(`--tier-adapter names tier "${tier}" more than once`);
    }
    try {
      const authChoice = buildExplicitAuthChoice(mode, fields) as Extract<
        AuthChoice,
        { mode: "api-key" | "local" | "gateway" }
      >; // `mode` was already restricted to api-key|local|gateway above, so this is never "subscription".
      tiers[tier] = deriveAdapterSpec(authChoice, fields.model !== undefined ? { model: fields.model } : {});
    } catch (error) {
      throw new CliUsageError(`--tier-adapter "${entry}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return tiers;
}
