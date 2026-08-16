import type { AgentEvent, RouteOptions, RouteResult } from "../index.js";

/**
 * Host-owned contract for deterministic, noninteractive dispatch.  This is
 * intentionally not the interactive terminal protocol: it contains no bytes
 * from a PTY, dispatcher stream, prompt, tool input/output, or credential.
 */
export const NATIVE_PRODUCER_VERSION = "1" as const;

const MAX_RESULT_TEXT = 16 * 1024;
const MAX_CASSETTE_BYTES = 64 * 1024;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_DIGEST = /^sha256:[a-f0-9]{64}$/;

export type NativeProducerVendor = "claude" | "codex";
export type NativeProducerErrorCode =
  | "unsupported_version"
  | "scope_mismatch"
  | "invalid_request"
  | "malformed_output"
  | "missing_replay"
  | "timeout"
  | "cancelled"
  | "producer_failed";

export interface NativeProducerScope {
  readonly bindingDigest: string;
}

export interface NativeProducerRequest {
  readonly version: typeof NATIVE_PRODUCER_VERSION;
  readonly vendor: NativeProducerVendor;
  readonly agentId: string;
  readonly input: string;
  readonly scope: NativeProducerScope;
  /** Host-selected idempotency key; never derived from prompt text. */
  readonly idempotencyKey: string;
}

/** A bounded, host-validated artifact pointer; never a local filesystem path. */
export interface NativeProducerArtifactReference {
  readonly id: string;
  readonly kind: "dashboard" | "report" | "chart";
  readonly digest: string;
  readonly idempotencyKey: string;
}

export type NativeProducerLifecycleState = "accepted" | "running" | "completed" | "failed";

export interface NativeProducerLifecycle {
  readonly state: NativeProducerLifecycleState;
}

export interface NativeProducerSuccess {
  readonly version: typeof NATIVE_PRODUCER_VERSION;
  readonly status: "completed";
  readonly lifecycle: readonly NativeProducerLifecycle[];
  /** Sanitized final result only; never an unparsed dispatcher stream. */
  readonly result: { readonly text: string };
  readonly artifacts: readonly NativeProducerArtifactReference[];
}

export interface NativeProducerFailure {
  readonly version: typeof NATIVE_PRODUCER_VERSION;
  readonly status: "failed";
  readonly lifecycle: readonly NativeProducerLifecycle[];
  /** Stable category only. Raw subprocess errors are intentionally not surfaced. */
  readonly error: { readonly code: NativeProducerErrorCode };
  readonly artifacts: readonly [];
}

export type NativeProducerResponse = NativeProducerSuccess | NativeProducerFailure;

export interface NativeProducerDispatchInput {
  readonly vendor: NativeProducerVendor;
  readonly agentId: string;
  readonly input: string;
  readonly scope: NativeProducerScope;
  readonly idempotencyKey: string;
  readonly signal: AbortSignal;
  readonly fence: NativeProducerHostFence;
  /** Events are available only for local bookkeeping; they never cross this contract. */
  readonly onEvent: (event: AgentEvent) => void;
}

/** Host-only bridge to durable session, binding, and artifact state. */
export interface NativeProducerHostFence {
  readonly bindingDigest: string;
  validateRun(request: NativeProducerRequest): boolean;
  validateRoute(request: NativeProducerRequest, userProject: string): boolean;
  validateArtifact(reference: NativeProducerArtifactReference, request: NativeProducerRequest): boolean;
}

export interface NativeProducerDispatchResult {
  readonly text: string;
  readonly artifacts?: readonly NativeProducerArtifactReference[];
}

export type NativeProducerDispatch = (input: NativeProducerDispatchInput) => Promise<NativeProducerDispatchResult>;

export interface NativeProducerOptions {
  readonly fence: NativeProducerHostFence;
  readonly dispatch: NativeProducerDispatch;
  readonly timeoutMs?: number;
  /** Host cancellation; it aborts only this producer's selected dispatcher. */
  readonly signal?: AbortSignal;
}

/**
 * A deterministic record of an already-sanitized producer response. It is
 * deliberately independent of the raw dispatcher cassette format: callers
 * replay a stable host contract, not a vendor's opaque wire bytes.
 */
export interface NativeProducerCassette {
  readonly version: typeof NATIVE_PRODUCER_VERSION;
  readonly key: string;
  readonly vendor: NativeProducerVendor;
  readonly agentId: string;
  readonly scope: NativeProducerScope;
  readonly response: NativeProducerResponse;
}

/** Stable, prompt-free cassette selector for one host-owned idempotent run. */
export function nativeProducerCassetteKey(request: NativeProducerRequest): string {
  return `${request.vendor}__${request.agentId}__${request.idempotencyKey}`;
}

/** Runs one noninteractive dispatch and always returns a typed, fail-closed response. */
export async function produceNoninteractiveNative(
  request: unknown,
  options: NativeProducerOptions,
): Promise<NativeProducerResponse> {
  const parsed = validateRequest(request);
  if (parsed === undefined) return failed("invalid_request");
  if (parsed.version !== NATIVE_PRODUCER_VERSION) return failed("unsupported_version");
  if (parsed.scope.bindingDigest !== options.fence.bindingDigest || !options.fence.validateRun(parsed)) return failed("scope_mismatch");
  if (options.signal?.aborted) return failed("cancelled");

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
  let stop: "timeout" | "cancelled" | undefined;
  const timeout = setTimeout(() => {
    stop = "timeout";
    controller.abort();
  }, timeoutMs);
  const cancel = () => {
    stop = "cancelled";
    controller.abort();
  };
  options.signal?.addEventListener("abort", cancel, { once: true });
  const events: AgentEvent[] = [];
  try {
    const dispatch = options.dispatch({
      vendor: parsed.vendor,
      agentId: parsed.agentId,
      input: parsed.input,
      scope: parsed.scope,
      idempotencyKey: parsed.idempotencyKey,
      signal: controller.signal,
      fence: options.fence,
      // Keep the private, potentially rich event stream inside the host. The
      // bounded public lifecycle below is intentionally synthesized instead.
      onEvent: (event) => events.push(event),
    });
    const result = await awaitWithAbort(dispatch, controller.signal);
    if (stop === "timeout") return failed("timeout");
    if (!options.fence.validateRun(parsed)) return failed("scope_mismatch");
    return complete(result, parsed, options.fence);
  } catch (error) {
    if (stop === "timeout") return failed("timeout");
    if (isAbortError(error) || controller.signal.aborted) return failed("cancelled");
    return failed("producer_failed");
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", cancel);
    // The dispatcher callback is intentionally retained only until completion.
    events.length = 0;
  }
}

/** Replays a sanitized producer cassette; absence, drift, and scope changes fail closed. */
export function replayNoninteractiveNative(
  request: unknown,
  cassette: unknown,
  fence: NativeProducerHostFence,
): NativeProducerResponse {
  const parsed = validateRequest(request);
  if (parsed === undefined) return failed("invalid_request");
  if (parsed.version !== NATIVE_PRODUCER_VERSION) return failed("unsupported_version");
  const parsedCassette = validateCassette(cassette, parsed.input);
  if (isRecord(cassette) && typeof cassette.version === "string" && cassette.version !== NATIVE_PRODUCER_VERSION) {
    return failed("unsupported_version");
  }
  if (parsedCassette === undefined) return failed("missing_replay");
  if (parsed.scope.bindingDigest !== fence.bindingDigest || !fence.validateRun(parsed)) return failed("scope_mismatch");
  if (parsedCassette.version !== NATIVE_PRODUCER_VERSION) return failed("unsupported_version");
  if (
    parsedCassette.vendor !== parsed.vendor ||
    parsedCassette.agentId !== parsed.agentId ||
    !sameScope(parsedCassette.scope, parsed.scope)
  ) return failed("scope_mismatch");
  if (parsedCassette.key !== nativeProducerCassetteKey(parsed)) return failed("missing_replay");
  if (parsedCassette.response.status === "completed" && !parsedCassette.response.artifacts.every((artifact) => fence.validateArtifact(artifact, parsed))) {
    return failed("scope_mismatch");
  }
  return parsedCassette.response;
}

/** Creates a checked-in/replayable record only from an already-safe response. */
export function createNativeProducerCassette(
  key: string,
  request: unknown,
  response: unknown,
  fence: NativeProducerHostFence,
): NativeProducerCassette {
  const parsed = validateRequest(request);
  const parsedResponse = validateResponse(response, parsed?.input);
  if (!parsed || !parsedResponse || parsed.scope.bindingDigest !== fence.bindingDigest || !fence.validateRun(parsed) || !SAFE_ID.test(key) || (parsedResponse.status === "completed" && !parsedResponse.artifacts.every((artifact) => fence.validateArtifact(artifact, parsed)))) {
    throw new Error("native producer cassette is invalid");
  }
  if (key !== nativeProducerCassetteKey(parsed)) {
    throw new Error("native producer cassette key does not match its idempotent request");
  }
  const cassette: NativeProducerCassette = {
    version: NATIVE_PRODUCER_VERSION,
    key,
    vendor: parsed.vendor,
    agentId: parsed.agentId,
    scope: parsed.scope,
    response: parsedResponse,
  };
  if (Buffer.byteLength(JSON.stringify(cassette)) > MAX_CASSETTE_BYTES) {
    throw new Error("native producer cassette exceeds its bounded contract");
  }
  return cassette;
}

/**
 * Adapts existing subscription dispatchers without widening their protocol.
 * The native producer only admits the vendor selected by the route options.
 */
export function createRouteNativeProducer(
  route: (options: RouteOptions) => Promise<RouteResult>,
  baseOptions: Omit<RouteOptions, "question" | "agentId" | "onEvent" | "signal">,
): NativeProducerDispatch {
  return async (input) => {
    const choice = baseOptions.authChoice;
    if (choice.mode !== "subscription" || choice.provider !== input.vendor) {
      throw new Error("native producer vendor does not match the configured route");
    }
    const request: NativeProducerRequest = {
      version: NATIVE_PRODUCER_VERSION,
      vendor: input.vendor,
      agentId: input.agentId,
      input: input.input,
      scope: input.scope,
      idempotencyKey: input.idempotencyKey,
    };
    if (!input.fence.validateRoute(request, baseOptions.userProject)) {
      throw new Error("native producer route fence rejected the request");
    }
    const result = await route({
      ...baseOptions,
      question: input.input,
      agentId: input.agentId,
      onEvent: input.onEvent,
      signal: input.signal,
    });
    return { text: resultText(result) };
  };
}

function resultText(result: RouteResult): string {
  if (result.backend === "agent") {
    if (result.kind === "refusal") throw new Error("producer refused result");
    return JSON.stringify(result.envelope);
  }
  return result.finalText;
}

function complete(value: unknown, request: NativeProducerRequest, fence: NativeProducerHostFence): NativeProducerResponse {
  if (!isRecord(value) || typeof value.text !== "string" || !value.text.trim()) return failed("malformed_output");
  const text = sanitizeResultText(value.text, request.input);
  if (text === undefined) return failed("malformed_output");
  const artifacts = value.artifacts === undefined ? [] : value.artifacts;
  if (!Array.isArray(artifacts) || !artifacts.every((artifact) => validArtifact(artifact) && fence.validateArtifact(artifact, request))) {
    return failed("malformed_output");
  }
  const rebuiltArtifacts = rebuildArtifacts(artifacts);
  if (!rebuiltArtifacts) return failed("malformed_output");
  return {
    version: NATIVE_PRODUCER_VERSION,
    status: "completed",
    lifecycle: [{ state: "accepted" }, { state: "running" }, { state: "completed" }],
    result: { text },
    artifacts: rebuiltArtifacts,
  };
}

function failed(code: NativeProducerErrorCode): NativeProducerFailure {
  return {
    version: NATIVE_PRODUCER_VERSION,
    status: "failed",
    lifecycle: [{ state: "accepted" }, { state: "running" }, { state: "failed" }],
    error: { code },
    artifacts: [],
  };
}

function validateRequest(value: unknown): NativeProducerRequest | undefined {
  if (!isRecord(value) || !onlyKeys(value, ["version", "vendor", "agentId", "input", "scope", "idempotencyKey"])) return undefined;
  if (typeof value.version !== "string" || (value.vendor !== "claude" && value.vendor !== "codex") || typeof value.agentId !== "string" || typeof value.input !== "string" || typeof value.idempotencyKey !== "string") return undefined;
  if (!SAFE_ID.test(value.agentId) || !SAFE_ID.test(value.idempotencyKey) || value.input.length === 0 || value.input.length > MAX_RESULT_TEXT) return undefined;
  const scope = validateScope(value.scope);
  if (!scope) return undefined;
  return { version: value.version as typeof NATIVE_PRODUCER_VERSION, vendor: value.vendor, agentId: value.agentId, input: value.input, scope, idempotencyKey: value.idempotencyKey };
}

function validateCassette(value: unknown, prompt?: string): NativeProducerCassette | undefined {
  if (!isRecord(value) || !onlyKeys(value, ["version", "key", "vendor", "agentId", "scope", "response"])) return undefined;
  if (value.version !== NATIVE_PRODUCER_VERSION || !SAFE_ID.test(String(value.key)) || (value.vendor !== "claude" && value.vendor !== "codex") || !SAFE_ID.test(String(value.agentId))) return undefined;
  const scope = validateScope(value.scope);
  const response = validateResponse(value.response, prompt);
  if (!scope || !response) return undefined;
  return { version: NATIVE_PRODUCER_VERSION, key: value.key as string, vendor: value.vendor, agentId: value.agentId as string, scope, response };
}

function validateResponse(value: unknown, prompt?: string): NativeProducerResponse | undefined {
  if (!isRecord(value) || value.version !== NATIVE_PRODUCER_VERSION || !Array.isArray(value.lifecycle)) return undefined;
  if (value.status === "completed" && isRecord(value.result) && typeof value.result.text === "string" && Array.isArray(value.artifacts)) {
    if (!onlyKeys(value, ["version", "status", "lifecycle", "result", "artifacts"])) return undefined;
    const lifecycle = rebuildLifecycle(value.lifecycle, "completed");
    const text = sanitizeResultText(value.result.text, prompt);
    const artifacts = rebuildArtifacts(value.artifacts);
    if (!lifecycle || text === undefined || !artifacts || !onlyKeys(value.result, ["text"])) return undefined;
    return { version: NATIVE_PRODUCER_VERSION, status: "completed", lifecycle, result: { text }, artifacts };
  }
  if (value.status === "failed" && isRecord(value.error) && typeof value.error.code === "string" && Array.isArray(value.artifacts) && value.artifacts.length === 0 && validErrorCode(value.error.code)) {
    if (!onlyKeys(value, ["version", "status", "lifecycle", "error", "artifacts"])) return undefined;
    const lifecycle = rebuildLifecycle(value.lifecycle, "failed");
    if (!lifecycle || !onlyKeys(value.error, ["code"])) return undefined;
    return { version: NATIVE_PRODUCER_VERSION, status: "failed", lifecycle, error: { code: value.error.code }, artifacts: [] };
  }
  return undefined;
}

function validateScope(value: unknown): NativeProducerScope | undefined {
  if (!isRecord(value) || !onlyKeys(value, ["bindingDigest"]) || typeof value.bindingDigest !== "string" || !SAFE_DIGEST.test(value.bindingDigest)) return undefined;
  return { bindingDigest: value.bindingDigest };
}

function validArtifact(value: unknown): value is NativeProducerArtifactReference {
  return isRecord(value) && onlyKeys(value, ["id", "kind", "digest", "idempotencyKey"]) && SAFE_ID.test(String(value.id)) && SAFE_ID.test(String(value.idempotencyKey)) && SAFE_DIGEST.test(String(value.digest)) && ["dashboard", "report", "chart"].includes(String(value.kind));
}

function sanitizeResultText(text: string, prompt?: string): string | undefined {
  if (
    Buffer.byteLength(text) > MAX_RESULT_TEXT ||
    /[\u0000-\u001f\u007f-\u009f]/.test(text) ||
    (prompt !== undefined && text.includes(prompt)) ||
    /^\s*(?:\{|\[)/.test(text) ||
    /\b(?:tool(?:[_ -]?(?:call|result|input|output))?|mcp(?:[_ -]?(?:tool|server|message))?|capability(?:[_ -]?(?:token|credential|grant))?|(?:api[_ -]?key|secret|token|password|authorization|credential))\b\s*[:=]|\bBearer\s+[A-Za-z0-9._-]+|\/(?:Users|home)\//i.test(text)
  ) return undefined;
  return text.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[redacted-id]");
}

function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException("cancelled", "AbortError"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function validErrorCode(value: string): value is NativeProducerErrorCode {
  return ["unsupported_version", "scope_mismatch", "invalid_request", "malformed_output", "missing_replay", "timeout", "cancelled", "producer_failed"].includes(value);
}

function rebuildLifecycle(value: readonly unknown[], terminal: "completed" | "failed"): readonly NativeProducerLifecycle[] | undefined {
  if (value.length !== 3) return undefined;
  const states: NativeProducerLifecycleState[] = ["accepted", "running", terminal];
  const rebuilt: NativeProducerLifecycle[] = [];
  for (let index = 0; index < states.length; index += 1) {
    const entry = value[index];
    if (!isRecord(entry) || !onlyKeys(entry, ["state"]) || entry.state !== states[index]) return undefined;
    rebuilt.push({ state: states[index]! });
  }
  return rebuilt;
}

function rebuildArtifacts(value: readonly unknown[]): readonly NativeProducerArtifactReference[] | undefined {
  const rebuilt: NativeProducerArtifactReference[] = [];
  for (const artifact of value) {
    if (!validArtifact(artifact)) return undefined;
    const record = artifact as unknown as Record<string, unknown>;
    rebuilt.push({ id: record.id as string, kind: record.kind as NativeProducerArtifactReference["kind"], digest: record.digest as string, idempotencyKey: record.idempotencyKey as string });
  }
  return rebuilt;
}

function sameScope(a: NativeProducerScope, b: NativeProducerScope): boolean {
  return a.bindingDigest === b.bindingDigest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
