/**
 * Endpoint-safe projection for the local launch attestation. The on-disk file
 * also contains a `local` section used only by startup wrappers; that section
 * must never cross an HTTP boundary.
 */
export interface LaunchAttestationPublic {
  readonly version: "genbi-launch-attestation/v1";
  readonly mode: "bootstrap";
  readonly genbi: {
    readonly rootDigest: string;
    readonly commit: string;
    readonly treeIdentity: string;
    /** Profiles and their committed IRs live in this package, so their identity is attested here. */
    readonly runtimeInputs: { readonly profileTreeSha256: string; readonly setupIrSha256: string; readonly enrichIrSha256: string; readonly analysisIrSha256: string };
  };
  readonly warble: {
    readonly rootDigest: string;
    readonly commit: string;
    readonly treeIdentity: string;
    readonly binarySha256: string;
  };
  readonly runtime:
    | { readonly mode: "subscription"; readonly provider: "claude"; readonly dispatcher: "claude-agent-sdk"; readonly agentSdkSha256: string }
    | { readonly mode: "subscription"; readonly provider: "codex"; readonly dispatcher: "codex-local"; readonly codexLocalSha256: string; readonly source: "standalone" | "npm:@openai/codex"; readonly executablePathDigest: string; readonly sourceClosureSha256: string; readonly version: string; readonly executableSha256: string };
  readonly bff: { readonly entrySha256: string; readonly closureSha256: string };
  readonly ui: { readonly rootDigest: string; readonly commit: string; readonly treeIdentity: string };
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function digest(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function commit(value: unknown): value is string { return typeof value === "string" && value.length > 0 && !value.includes("/") && !value.includes("\\"); }
function codexVersion(value: unknown): value is string { return typeof value === "string" && /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(value); }

/**
 * Validates an exact public shape and returns a newly-allocated projection.
 * `local` is accepted only on the source object so the same full file can be
 * read by startup code, but it is deliberately not copied into the result.
 */
export function projectPublicLaunchAttestation(value: unknown, expectedMode?: "bootstrap" | "bound"): LaunchAttestationPublic {
  if (!record(value) || !exactKeys(value, Object.hasOwn(value, "local")
    ? ["version", "mode", "genbi", "warble", "runtime", "bff", "ui", "local"]
    : ["version", "mode", "genbi", "warble", "runtime", "bff", "ui"])) throw new Error("local launch attestation public shape is invalid");
  if (value.version !== "genbi-launch-attestation/v1" || value.mode !== "bootstrap" || (expectedMode !== undefined && value.mode !== expectedMode)) throw new Error("local launch attestation public shape is invalid");
  if (!record(value.genbi) || !exactKeys(value.genbi, ["rootDigest", "commit", "treeIdentity", "runtimeInputs"]) || !digest(value.genbi.rootDigest) || !commit(value.genbi.commit) || !digest(value.genbi.treeIdentity) || !record(value.genbi.runtimeInputs) || !exactKeys(value.genbi.runtimeInputs, ["profileTreeSha256", "setupIrSha256", "enrichIrSha256", "analysisIrSha256"]) || !digest(value.genbi.runtimeInputs.profileTreeSha256) || !digest(value.genbi.runtimeInputs.setupIrSha256) || !digest(value.genbi.runtimeInputs.enrichIrSha256) || !digest(value.genbi.runtimeInputs.analysisIrSha256)) throw new Error("local launch attestation public shape is invalid");
  if (!record(value.warble) || !exactKeys(value.warble, ["rootDigest", "commit", "treeIdentity", "binarySha256"]) || !digest(value.warble.rootDigest) || !commit(value.warble.commit) || !digest(value.warble.treeIdentity) || !digest(value.warble.binarySha256)) throw new Error("local launch attestation public shape is invalid");
  if (!record(value.runtime) || value.runtime.mode !== "subscription") throw new Error("local launch attestation public shape is invalid");
  const claudeRuntime = exactKeys(value.runtime, ["mode", "provider", "dispatcher", "agentSdkSha256"])
    && value.runtime.provider === "claude" && value.runtime.dispatcher === "claude-agent-sdk" && digest(value.runtime.agentSdkSha256);
  const codexRuntime = exactKeys(value.runtime, ["mode", "provider", "dispatcher", "codexLocalSha256", "source", "executablePathDigest", "sourceClosureSha256", "version", "executableSha256"])
    && value.runtime.provider === "codex" && value.runtime.dispatcher === "codex-local" && digest(value.runtime.codexLocalSha256)
    && (value.runtime.source === "standalone" || value.runtime.source === "npm:@openai/codex") && digest(value.runtime.executablePathDigest)
    && digest(value.runtime.sourceClosureSha256) && codexVersion(value.runtime.version) && digest(value.runtime.executableSha256);
  if (!claudeRuntime && !codexRuntime) throw new Error("local launch attestation public shape is invalid");
  if (!record(value.bff) || !exactKeys(value.bff, ["entrySha256", "closureSha256"]) || !digest(value.bff.entrySha256) || !digest(value.bff.closureSha256)) throw new Error("local launch attestation public shape is invalid");
  if (!record(value.ui) || !exactKeys(value.ui, ["rootDigest", "commit", "treeIdentity"]) || !digest(value.ui.rootDigest) || !commit(value.ui.commit) || !digest(value.ui.treeIdentity)) throw new Error("local launch attestation public shape is invalid");
  return {
    version: value.version,
    mode: value.mode,
    genbi: { rootDigest: value.genbi.rootDigest, commit: value.genbi.commit, treeIdentity: value.genbi.treeIdentity, runtimeInputs: { profileTreeSha256: value.genbi.runtimeInputs.profileTreeSha256, setupIrSha256: value.genbi.runtimeInputs.setupIrSha256, enrichIrSha256: value.genbi.runtimeInputs.enrichIrSha256, analysisIrSha256: value.genbi.runtimeInputs.analysisIrSha256 } },
    warble: { rootDigest: value.warble.rootDigest, commit: value.warble.commit, treeIdentity: value.warble.treeIdentity, binarySha256: value.warble.binarySha256 },
    runtime: claudeRuntime
      ? { mode: "subscription", provider: "claude", dispatcher: "claude-agent-sdk", agentSdkSha256: value.runtime.agentSdkSha256 as string }
      : { mode: "subscription", provider: "codex", dispatcher: "codex-local", codexLocalSha256: value.runtime.codexLocalSha256 as string, source: value.runtime.source as "standalone" | "npm:@openai/codex", executablePathDigest: value.runtime.executablePathDigest as string, sourceClosureSha256: value.runtime.sourceClosureSha256 as string, version: value.runtime.version as string, executableSha256: value.runtime.executableSha256 as string },
    bff: { entrySha256: value.bff.entrySha256, closureSha256: value.bff.closureSha256 },
    ui: { rootDigest: value.ui.rootDigest, commit: value.ui.commit, treeIdentity: value.ui.treeIdentity },
  };
}
