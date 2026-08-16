/**
 * Endpoint-safe projection for the local launch attestation. The on-disk file
 * also contains a `local` section used only by startup wrappers; that section
 * must never cross an HTTP boundary.
 */
export interface LaunchAttestationPublic {
  readonly version: "genbi-launch-attestation/v1";
  readonly mode: "bootstrap" | "bound";
  readonly genbi: { readonly rootDigest: string; readonly commit: string; readonly treeIdentity: string };
  readonly warble: {
    readonly rootDigest: string;
    readonly commit: string;
    readonly treeIdentity: string;
    readonly binarySha256: string;
    readonly runtimeInputs: { readonly profileTreeSha256: string; readonly setupIrSha256: string; readonly enrichIrSha256: string; readonly analysisIrSha256: string };
  };
  readonly runtime: { readonly mode: "subscription"; readonly provider: "claude"; readonly dispatcher: "claude-agent-sdk"; readonly agentSdkSha256: string };
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

/**
 * Validates an exact public shape and returns a newly-allocated projection.
 * `local` is accepted only on the source object so the same full file can be
 * read by startup code, but it is deliberately not copied into the result.
 */
export function projectPublicLaunchAttestation(value: unknown, expectedMode?: "bootstrap" | "bound"): LaunchAttestationPublic {
  if (!record(value) || !exactKeys(value, Object.hasOwn(value, "local")
    ? ["version", "mode", "genbi", "warble", "runtime", "bff", "ui", "local"]
    : ["version", "mode", "genbi", "warble", "runtime", "bff", "ui"])) throw new Error("local launch attestation public shape is invalid");
  if (value.version !== "genbi-launch-attestation/v1" || (value.mode !== "bootstrap" && value.mode !== "bound") || (expectedMode !== undefined && value.mode !== expectedMode)) throw new Error("local launch attestation public shape is invalid");
  if (!record(value.genbi) || !exactKeys(value.genbi, ["rootDigest", "commit", "treeIdentity"]) || !digest(value.genbi.rootDigest) || !commit(value.genbi.commit) || !digest(value.genbi.treeIdentity)) throw new Error("local launch attestation public shape is invalid");
  if (!record(value.warble) || !exactKeys(value.warble, ["rootDigest", "commit", "treeIdentity", "binarySha256", "runtimeInputs"]) || !digest(value.warble.rootDigest) || !commit(value.warble.commit) || !digest(value.warble.treeIdentity) || !digest(value.warble.binarySha256) || !record(value.warble.runtimeInputs) || !exactKeys(value.warble.runtimeInputs, ["profileTreeSha256", "setupIrSha256", "enrichIrSha256", "analysisIrSha256"]) || !digest(value.warble.runtimeInputs.profileTreeSha256) || !digest(value.warble.runtimeInputs.setupIrSha256) || !digest(value.warble.runtimeInputs.enrichIrSha256) || !digest(value.warble.runtimeInputs.analysisIrSha256)) throw new Error("local launch attestation public shape is invalid");
  if (!record(value.runtime) || !exactKeys(value.runtime, ["mode", "provider", "dispatcher", "agentSdkSha256"]) || value.runtime.mode !== "subscription" || value.runtime.provider !== "claude" || value.runtime.dispatcher !== "claude-agent-sdk" || !digest(value.runtime.agentSdkSha256)) throw new Error("local launch attestation public shape is invalid");
  if (!record(value.bff) || !exactKeys(value.bff, ["entrySha256", "closureSha256"]) || !digest(value.bff.entrySha256) || !digest(value.bff.closureSha256)) throw new Error("local launch attestation public shape is invalid");
  if (!record(value.ui) || !exactKeys(value.ui, ["rootDigest", "commit", "treeIdentity"]) || !digest(value.ui.rootDigest) || !commit(value.ui.commit) || !digest(value.ui.treeIdentity)) throw new Error("local launch attestation public shape is invalid");
  return {
    version: value.version,
    mode: value.mode,
    genbi: { rootDigest: value.genbi.rootDigest, commit: value.genbi.commit, treeIdentity: value.genbi.treeIdentity },
    warble: { rootDigest: value.warble.rootDigest, commit: value.warble.commit, treeIdentity: value.warble.treeIdentity, binarySha256: value.warble.binarySha256, runtimeInputs: { profileTreeSha256: value.warble.runtimeInputs.profileTreeSha256, setupIrSha256: value.warble.runtimeInputs.setupIrSha256, enrichIrSha256: value.warble.runtimeInputs.enrichIrSha256, analysisIrSha256: value.warble.runtimeInputs.analysisIrSha256 } },
    runtime: { mode: value.runtime.mode, provider: value.runtime.provider, dispatcher: value.runtime.dispatcher, agentSdkSha256: value.runtime.agentSdkSha256 },
    bff: { entrySha256: value.bff.entrySha256, closureSha256: value.bff.closureSha256 },
    ui: { rootDigest: value.ui.rootDigest, commit: value.ui.commit, treeIdentity: value.ui.treeIdentity },
  };
}
