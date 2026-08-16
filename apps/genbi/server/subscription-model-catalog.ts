import { spawn } from "node:child_process";
import { resolveAgentSdkCli } from "../harness/index.js";
import { resolveCodexLocalCli } from "../harness/route/codex-local-cli.js";
import type { SubscriptionModelCatalog, SubscriptionModelCatalogEntry, SubscriptionProvider } from "./wire-types.js";

const CATALOG_TIMEOUT_MS = 15_000;
const CATALOG_CACHE_MS = 30_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const TERMINATION_GRACE_MS = 1_000;

type RawRecord = Record<string, unknown>;

export interface SubscriptionModelCatalogOptions {
  readonly agentSdkBin?: string;
  readonly codexLocalBin?: string;
  readonly codexHome?: string;
  readonly codexBin?: string;
  /** The live project identity used by the runtime, when one is bound. */
  readonly getUserProject: () => string | undefined;
  /** Hermetic test seam. It receives no credentials and returns parsed JSON only. */
  readonly execute?: (provider: SubscriptionProvider) => Promise<unknown>;
  readonly now?: () => number;
}

function unavailable(
  provider: SubscriptionProvider,
  code: Extract<SubscriptionModelCatalog, { status: "unavailable" }>["code"],
  retryable = true,
): SubscriptionModelCatalog {
  return { version: 1, status: "unavailable", provider, code, retryable };
}

function record(value: unknown): RawRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as RawRecord : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function entry(value: unknown): SubscriptionModelCatalogEntry | undefined {
  const candidate = record(value);
  const model = candidate && nonEmptyString(candidate.model);
  const displayName = candidate && nonEmptyString(candidate.displayName);
  if (!candidate || !model || !displayName) return undefined;
  const description = typeof candidate.description === "string" ? candidate.description : undefined;
  const reasoningEfforts = Array.isArray(candidate.reasoningEfforts)
    ? candidate.reasoningEfforts.map((effort) => {
        const item = record(effort);
        const value = item && nonEmptyString(item.value);
        const effortDisplayName = item && nonEmptyString(item.displayName);
        if (!item || !value || !effortDisplayName) return undefined;
        return {
          value,
          displayName: effortDisplayName,
          ...(typeof item.description === "string" ? { description: item.description } : {}),
        };
      }).filter((item): item is NonNullable<typeof item> => item !== undefined)
    : undefined;
  return {
    model,
    displayName,
    ...(description !== undefined ? { description } : {}),
    ...(typeof candidate.isDefault === "boolean" ? { isDefault: candidate.isDefault } : {}),
    ...(reasoningEfforts && reasoningEfforts.length > 0 ? { reasoningEfforts } : {}),
  };
}

/** Parses a provider payload into the public allowlist, intentionally discarding every other field. */
export function sanitizeSubscriptionModelCatalog(provider: SubscriptionProvider, payload: unknown): SubscriptionModelCatalog {
  const result = record(payload);
  if (!result || result.version !== 1 || result.provider !== provider) return unavailable(provider, "protocol_error", false);
  if (result.status === "unavailable") {
    const code = result.code;
    if (code !== "not_authenticated" && code !== "runtime_unavailable" && code !== "timeout" && code !== "protocol_error") {
      return unavailable(provider, "protocol_error", false);
    }
    return unavailable(provider, code, typeof result.retryable === "boolean" ? result.retryable : true);
  }
  if (result.status !== "ready" || !Array.isArray(result.models)) return unavailable(provider, "protocol_error", false);
  const models = result.models.map(entry);
  if (models.some((model) => model === undefined)) return unavailable(provider, "protocol_error", false);
  return { version: 1, status: "ready", provider, models: models as SubscriptionModelCatalogEntry[] };
}

async function runProviderCommand(provider: SubscriptionProvider, options: SubscriptionModelCatalogOptions): Promise<unknown> {
  const cli = provider === "claude"
    ? await resolveAgentSdkCli(options.agentSdkBin)
    : await resolveCodexLocalCli(options.codexLocalBin);
  // `list-models` is intentionally a provider-owned, no-turn command. Its
  // documented flags mirror the active runtime's project/Codex identity; the
  // process output still crosses this module only after allowlist validation.
  const project = options.getUserProject();
  const args = [
    ...cli.prefixArgs,
    "list-models",
    ...(project ? ["--project", project] : []),
    ...(provider === "codex" && options.codexHome ? ["--codex-home", options.codexHome] : []),
    ...(provider === "codex" && options.codexBin ? ["--codex-bin", options.codexBin] : []),
    "--timeout",
    String(CATALOG_TIMEOUT_MS),
  ];
  return spawnJson(cli.command, args, { env: process.env });
}

/**
 * Runs a provider-owned command with bounded output and process-group cleanup.
 * The test-only `onSpawn` hook observes only a PID; it never crosses the BFF
 * wire boundary and lets the regression suite prove a TERM-ignoring child is
 * eventually removed by the group KILL fallback.
 */
export function spawnJson(
  command: string,
  args: readonly string[],
  options: { readonly env: NodeJS.ProcessEnv; readonly cwd?: string; readonly onSpawn?: (pid: number) => void },
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      env: options.env,
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let bytes = 0;
    let settled = false;
    let timedOut = false;
    let cleanupStarted = false;
    const signalProcessGroup = (signal: NodeJS.Signals): void => {
      if (child.pid !== undefined && process.platform !== "win32") {
        try { process.kill(-child.pid, signal); return; } catch { /* direct-child fallback */ }
      }
      child.kill(signal);
    };
    const cleanup = (): void => {
      if (cleanupStarted) return;
      cleanupStarted = true;
      signalProcessGroup("SIGTERM");
      // Never clear this fallback on an early caller settlement: the command
      // may ignore TERM (or have descendants) after the BFF has returned its
      // sanitized failure. KILLing the detached group prevents a leak.
      setTimeout(() => signalProcessGroup("SIGKILL"), TERMINATION_GRACE_MS).unref();
    };
    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };
    const abort = (error: "timeout" | "protocol_error"): void => {
      cleanup();
      settle(() => reject(new Error(error)));
    };
    if (child.pid !== undefined) options.onSpawn?.(child.pid);
    const timer = setTimeout(() => {
      timedOut = true;
      abort("timeout");
    }, CATALOG_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) {
        abort("protocol_error");
        return;
      }
      stdout += chunk.toString("utf8");
    });
    // Drain stderr without retaining it: provider details must never cross the BFF boundary.
    child.stderr.resume();
    child.on("error", () => settle(() => reject(new Error("runtime_unavailable"))));
    child.on("close", (code) => settle(() => {
      if (timedOut) { reject(new Error("timeout")); return; }
      if (code !== 0) { reject(new Error("runtime_unavailable")); return; }
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error("protocol_error")); }
    }));
  });
}

/** Builds the BFF seam and owns a small provider-keyed process-memory TTL cache. */
export function createSubscriptionModelCatalog(options: SubscriptionModelCatalogOptions): (provider: SubscriptionProvider, refresh: boolean) => Promise<SubscriptionModelCatalog> {
  const cache = new Map<SubscriptionProvider, { readonly expiresAt: number; readonly result: SubscriptionModelCatalog }>();
  const latestRequest = new Map<SubscriptionProvider, number>();
  const now = options.now ?? Date.now;
  return async (provider, refresh) => {
    const cached = cache.get(provider);
    if (!refresh && cached && cached.expiresAt > now()) return cached.result;
    const requestId = (latestRequest.get(provider) ?? 0) + 1;
    latestRequest.set(provider, requestId);
    const writeCacheIfCurrent = (result: SubscriptionModelCatalog): SubscriptionModelCatalog => {
      // A refresh is authoritative over every request that preceded it. An
      // older promise may still resolve for its original caller, but cannot
      // replace the provider cache used by subsequent reads.
      if (latestRequest.get(provider) === requestId) {
        cache.set(provider, { expiresAt: now() + CATALOG_CACHE_MS, result });
      }
      return result;
    };
    try {
      const raw = await (options.execute ? options.execute(provider) : runProviderCommand(provider, options));
      const result = sanitizeSubscriptionModelCatalog(provider, raw);
      return writeCacheIfCurrent(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "runtime_unavailable";
      const code = message === "timeout" ? "timeout" : message === "protocol_error" ? "protocol_error" : "runtime_unavailable";
      const result = unavailable(provider, code, code !== "protocol_error");
      return writeCacheIfCurrent(result);
    }
  };
}
