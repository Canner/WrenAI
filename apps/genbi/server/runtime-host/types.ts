/**
 * The session runtime boundary is intentionally smaller than the existing
 * native-session lifecycle.  This module describes what the browser may know
 * about a backend; process details remain in the host-only diagnostic surface.
 */
export const RUNTIME_BACKEND_IDS = ["local", "codex-app-server", "claude-sandbox-runtime"] as const;
export type RuntimeBackendId = (typeof RUNTIME_BACKEND_IDS)[number];

export const RUNTIME_CAPABILITIES = [
  "pty",
  "terminal_replay",
  "terminal_resize",
  "terminal_terminate",
  "app_server_rpc",
  "sandbox_policy",
  "filesystem_isolation",
  "network_isolation",
] as const;
export type RuntimeCapability = (typeof RUNTIME_CAPABILITIES)[number];

export type RuntimeReadinessState = "ready" | "unavailable" | "incompatible" | "unprovisioned";

export const RUNTIME_BACKEND_REASON_CODES = {
  local: ["local_runtime_disabled", "local_runtime_host_unavailable", "local_runtime_production_forbidden", "runtime_probe_failed"],
  "codex-app-server": [
    "codex_app_server_unprovisioned",
    "codex_cli_missing",
    "codex_cli_version_malformed",
    "codex_cli_version_unsupported",
    "codex_identity_uncertified",
    "codex_app_server_unreachable",
    "codex_app_server_protocol_incompatible",
    "codex_sandbox_policy_unavailable",
    "codex_permission_profile_unavailable",
    "codex_wren_manifest_missing",
    "codex_wren_manifest_invalid",
    "codex_wren_platform_unsupported",
    "codex_wren_runtime_unprovisioned",
    "codex_wren_provision_failed",
    "codex_wren_interpreter_mismatch",
    "codex_wren_launcher_mismatch",
    "codex_wren_package_mismatch",
    "codex_wren_closure_mismatch",
    "codex_wren_profile_unavailable",
    "codex_wren_secret_unavailable",
    "codex_wren_session_home_unavailable",
    "codex_wren_child_env_invalid",
    "runtime_platform_unsupported",
    "runtime_policy_unavailable",
    "runtime_probe_failed",
  ],
  "claude-sandbox-runtime": [
    "claude_sandbox_runtime_unprovisioned",
    "claude_cli_missing",
    "claude_cli_version_malformed",
    "claude_cli_version_unsupported",
    "claude_identity_uncertified",
    "claude_sandbox_runtime_missing",
    "claude_sandbox_runtime_version_malformed",
    "claude_sandbox_runtime_version_unsupported",
    "claude_sandbox_capability_missing",
    "runtime_platform_unsupported",
    "runtime_policy_unavailable",
    "runtime_probe_failed",
  ],
} as const;

export type RuntimeBackendReasonCode<B extends RuntimeBackendId = RuntimeBackendId> =
  (typeof RUNTIME_BACKEND_REASON_CODES)[B][number];

export interface RuntimeBackendReady {
  readonly state: "ready";
  /** Certified or development-local version token; never command output. */
  readonly version: string;
  /** Public capability names only. */
  readonly capabilities: readonly RuntimeCapability[];
}

export interface RuntimeBackendNotReady<B extends RuntimeBackendId = RuntimeBackendId> {
  readonly state: "unavailable" | "incompatible" | "unprovisioned";
  readonly code: RuntimeBackendReasonCode<B>;
  /** Fixed text derived from `code`, never from a command, path, or environment. */
  readonly message: string;
}

export type RuntimeBackendReadiness<B extends RuntimeBackendId = RuntimeBackendId> =
  | RuntimeBackendReady
  | RuntimeBackendNotReady<B>;

/** Browser/API-safe projection. The selected result is always this record's own member. */
export interface RuntimeReadiness {
  readonly selected: RuntimeBackendId;
  readonly selectedReadiness: RuntimeBackendReadiness;
  readonly backends: Readonly<Record<RuntimeBackendId, RuntimeBackendReadiness>>;
}

/**
 * Host-only support evidence. Values are constrained to parsed tokens and
 * declared capabilities; no raw command output, filesystem path, credential,
 * or environment value belongs in this type.
 */
export interface RuntimeBackendDiagnostic {
  readonly phase: "policy" | "platform" | "version" | "identity" | "capability" | "provisioning" | "probe";
  readonly observedVersion?: string;
  readonly requiredCapability?: RuntimeCapability;
  readonly attestedIdentity?: `sha256:${string}`;
}

export type RuntimeDiagnostics = Readonly<Record<RuntimeBackendId, RuntimeBackendDiagnostic>>;

export interface RuntimeBackendProbeResult<B extends RuntimeBackendId = RuntimeBackendId> {
  readonly readiness: RuntimeBackendReadiness<B>;
  readonly diagnostic: RuntimeBackendDiagnostic;
}
