import { z } from "zod";
import { runtimeNotReady, runtimeReady } from "./policy.js";
import type { RuntimeBackendProbeResult } from "./types.js";

export const CODEX_BASELINE_VERSION = "0.146.0";
export const CODEX_REQUIRED_CONTRACTS = [
  "initialize", "config/read", "thread/start", "turn/start", "turn/interrupt",
  "permissionProfile/list", "thread/start.permissions", "turn/start.permissions", "command/exec.permissionProfile",
  "command/exec", "command/exec/write", "command/exec/resize", "command/exec/terminate",
  "protected_read", "network_deny", "timeout_cleanup", "connection_cleanup",
] as const;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const codexCertificationSchema = z.object({
  state: z.literal("certified_row"),
  platform: z.literal("darwin-arm64"),
  version: z.literal(CODEX_BASELINE_VERSION),
  executableSha256: digest,
  source: z.string().url().refine((value) => value.startsWith("https://")),
  protocolSha256: digest,
  contracts: z.array(z.enum(CODEX_REQUIRED_CONTRACTS)).refine((values) =>
    values.length === CODEX_REQUIRED_CONTRACTS.length && new Set(values).size === values.length),
  evidence: z.object({
    deterministicProbesSha256: digest,
    packedAcceptanceSha256: digest,
    releaseApprovalSha256: digest,
  }).strict(),
}).strict();
export type CodexCertification = z.infer<typeof codexCertificationSchema>;

// Tested baseline evidence is not a production execution grant. Release
// engineering must add an exact reviewed row, never a minimum-version range.
export const CODEX_CERTIFIED_ROWS: readonly CodexCertification[] = Object.freeze([]);
export interface CodexObservedIdentity {
  readonly platform: string;
  readonly versionOutput: string;
  readonly executableSha256: string;
  readonly source: string;
  readonly protocolSha256: string;
  readonly contracts: readonly string[];
}

/** Pure comparison for release verification; only the packaged rows grant execution. */
export function evaluateCodexIdentity(
  observed: CodexObservedIdentity,
  rows: readonly unknown[] = CODEX_CERTIFIED_ROWS,
): RuntimeBackendProbeResult<"codex-app-server"> {
  const deny = (code: Parameters<typeof runtimeNotReady<"codex-app-server">>[2], phase: "platform" | "version" | "identity" | "capability") => ({
    readiness: runtimeNotReady("codex-app-server", "incompatible", code), diagnostic: { phase },
  } as const);
  if (observed.platform !== "darwin-arm64") return deny("runtime_platform_unsupported", "platform");
  const match = /^codex-cli ([0-9]+\.[0-9]+\.[0-9]+)\r?\n?$/.exec(observed.versionOutput);
  if (!match) return deny("codex_cli_version_malformed", "version");
  if (match[1] !== CODEX_BASELINE_VERSION) return deny("codex_cli_version_unsupported", "version");
  const valid = rows.map((row) => codexCertificationSchema.safeParse(row)).filter((row) => row.success).map((row) => row.data!);
  const row = valid.find((candidate) =>
    candidate.executableSha256 === observed.executableSha256 && candidate.source === observed.source);
  if (!row) return deny("codex_identity_uncertified", "identity");
  if (row.protocolSha256 !== observed.protocolSha256) return deny("codex_app_server_protocol_incompatible", "capability");
  if (CODEX_REQUIRED_CONTRACTS.some((name) => !observed.contracts.includes(name))) {
    return deny("codex_sandbox_policy_unavailable", "capability");
  }
  return {
    readiness: runtimeReady(row.version, ["app_server_rpc", "sandbox_policy", "filesystem_isolation", "network_isolation", "pty", "terminal_resize", "terminal_terminate"]),
    diagnostic: { phase: "capability", observedVersion: row.version },
  };
}
