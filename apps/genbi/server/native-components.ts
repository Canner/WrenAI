import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { canonicalPlanJson, planDigest, readExecutionPlan } from "../harness/components/plan.js";
import { ComponentRunner, type ExecutionPlan, type RunnerHost } from "../harness/components/runner.js";
import type { ComponentInvocationResult } from "@warble/claude-agent-sdk";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const binding = z.object({ project_identity: z.string().min(1), generation: z.string().min(1), revision: z.string().min(1) }).strict();
const identity = {
  protocol: z.literal("warble-component-host/1"), execution: z.literal("host_owned_steps"),
  session_id: z.string().min(1), vendor: z.enum(["claude", "codex"]), auth_identity: z.string().min(1),
  runtime_generation: z.string().min(1), binding,
};
export const NATIVE_COMPONENT_REQUEST_SCHEMA = { type: "object", additionalProperties: false,
  properties: { request: { type: "string", minLength: 1, maxLength: 65_536 } }, required: ["request"],
} as const;
const rootTools = z.record(z.string(), z.string().regex(/^warble_run_[a-f0-9]{32}$/));
const launchHost = z.object({ ...identity, host_plan_sha256: digest,
  plan_path: z.literal(".warble/component-plans.json"), root_tools: rootTools,
}).strict();
const nativePlan = z.object({ ...identity, version: z.literal("1"), execution_status: z.literal("not_executed"),
  host_plan_sha256: digest, input_ir_sha256: digest, scope_sha256: digest,
  plans: z.record(z.string(), z.record(z.string(), z.unknown())), prepared_contexts: z.record(z.string(), digest),
  root_tools: rootTools, request_schema: z.unknown(),
}).strict();
export type NativeComponentIdentity = Pick<z.infer<typeof launchHost>, "session_id" | "vendor" | "auth_identity" | "runtime_generation" | "binding">;
export interface NativeComponentReceipt {
  readonly identity: NativeComponentIdentity;
  readonly irDocument: string;
  readonly scopeDocument: string;
  readonly hostRoots: Readonly<Record<string, unknown>>;
  readonly contexts: Readonly<Record<string, unknown>>;
}
export interface NativeComponentPlans {
  readonly identity: NativeComponentIdentity;
  readonly digest: string;
  readonly roots: Readonly<Record<string, ExecutionPlan>>;
  readonly tools: Readonly<Record<string, string>>;
}
/** Supplied by a certified server-side provisioner, never browser/runtime settings JSON. */
export interface NativeComponentPreparation {
  readonly identity: NativeComponentIdentity;
  readonly hostRoots: Readonly<Record<string, unknown>>;
  readonly contexts: Readonly<Record<string, unknown>>;
  /** Revalidates the approved account and exact vendor execution generation. */
  assertCurrent(): void;
  host(root: string, plan: ExecutionPlan, signal: AbortSignal): Promise<RunnerHost>;
}

export function nativeComponentHostContract(prepared: NativeComponentPreparation): Readonly<Record<string, unknown>> {
  prepared.assertCurrent();
  return { version: "1", protocol: "warble-component-host/1", ...structuredClone(prepared.identity),
    roots: structuredClone(prepared.hostRoots),
    prepared_contexts: Object.fromEntries(Object.entries(prepared.contexts).map(([id, context]) => [id, planDigest(context)])),
  };
}
function equal(left: unknown, right: unknown): void {
  if (!isDeepStrictEqual(left, right)) throw new Error("Native component receipt mismatch");
}
function bytesDigest(value: string): string { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }

/** Correlate emitted launch/plan data with host-owned inputs, never model arguments. */
export function readNativeComponentPlans(document: string, launch: unknown, receipt: NativeComponentReceipt): NativeComponentPlans {
  if (Buffer.byteLength(document) > 4 * 1024 * 1024) throw new Error("Native component plan exceeds byte limit");
  const raw = JSON.parse(document) as Record<string, unknown>;
  const parsed = nativePlan.parse(raw);
  const descriptor = launchHost.parse(launch);
  const { host_plan_sha256: claimed, ...payload } = raw;
  equal(claimed, planDigest(payload));
  equal(descriptor.host_plan_sha256, claimed);
  for (const key of ["session_id", "vendor", "auth_identity", "runtime_generation", "binding"] as const) {
    equal(parsed[key], receipt.identity[key]); equal(descriptor[key], receipt.identity[key]);
  }
  equal(parsed.input_ir_sha256, bytesDigest(receipt.irDocument));
  const scope = JSON.parse(receipt.scopeDocument);
  // The v3 scope contract defaults an omitted entry kind to the pinned agent form.
  if (scope.entry?.kind === undefined && typeof scope.entry?.verb === "string") scope.entry.kind = "agent";
  equal(parsed.scope_sha256, planDigest(scope));
  equal(parsed.root_tools, descriptor.root_tools);
  equal(parsed.request_schema, NATIVE_COMPONENT_REQUEST_SCHEMA);
  equal(Object.keys(parsed.plans).sort(), Object.keys(receipt.hostRoots).sort());
  equal(Object.keys(parsed.root_tools).sort(), Object.keys(parsed.plans).sort());
  if (new Set(Object.values(parsed.root_tools)).size !== Object.keys(parsed.root_tools).length) throw new Error("Duplicate native admission tool");
  equal(parsed.prepared_contexts, Object.fromEntries(Object.entries(receipt.contexts).map(([id, context]) => [id, planDigest(context)])));
  const ir = z.object({ context_binding: z.record(z.string(), z.unknown()), components: z.array(z.object({ id: z.string() }).passthrough()) }).passthrough().parse(JSON.parse(receipt.irDocument));
  const declarations = Object.fromEntries(ir.components.map((component) => [component.id, component]));
  const roots = Object.fromEntries(Object.entries(parsed.plans).map(([root, plan]) => {
    equal(plan.entry, root);
    const executable = readExecutionPlan(JSON.stringify(plan), { digest: digest.parse(plan.plan_sha256), inputIrDigest: parsed.input_ir_sha256,
      contextBinding: ir.context_binding, declarations, directHostDocument: canonicalPlanJson(receipt.hostRoots[root]),
    });
    for (const id of Object.keys(executable.components)) if (!Object.hasOwn(receipt.contexts, id)) throw new Error("Missing native component context");
    return [root, executable];
  }));
  return { identity: structuredClone(receipt.identity), digest: parsed.host_plan_sha256, roots, tools: parsed.root_tools };
}

/** Per-session fixed-root admission. A tool name selects a root, never an active step. */
export class NativeComponentAdmission {
  private readonly controller = new AbortController();
  private readonly requests = new Set<string>();
  private active: Promise<ComponentInvocationResult> | undefined;
  private activeController: AbortController | undefined;
  private cleanupFailure = false;
  private closing?: Promise<void>;
  private readonly plans: NativeComponentPlans;
  constructor(plans: NativeComponentPlans, private readonly current: () => NativeComponentIdentity | undefined,
    private readonly host: (root: string, plan: ExecutionPlan, signal: AbortSignal) => Promise<RunnerHost>) {
    this.plans = structuredClone(plans);
  }
  private check(): void {
    this.controller.signal.throwIfAborted();
    if (!isDeepStrictEqual(this.current(), this.plans.identity)) {
      this.controller.abort(); throw new Error("Native component session expired");
    }
  }
  list(): readonly { name: string; description: string; inputSchema: typeof NATIVE_COMPONENT_REQUEST_SCHEMA }[] {
    this.check();
    return Object.entries(this.plans.tools).map(([root, name]) => ({ name,
      description: String(this.plans.roots[root]!.components[root]!.declaration.description ?? `Run ${root}`), inputSchema: NATIVE_COMPONENT_REQUEST_SCHEMA,
    }));
  }
  async call(name: string, input: unknown, requestId: string | number, signal?: AbortSignal): Promise<ComponentInvocationResult> {
    this.check();
    const root = Object.entries(this.plans.tools).find(([, tool]) => tool === name)?.[0];
    const parsed = z.object({ request: z.string().trim().min(1).max(65_536) }).strict().parse(input);
    if (!root || Buffer.byteLength(JSON.stringify(parsed)) > 65_536) throw new Error("Invalid native component request");
    const key = JSON.stringify(requestId);
    if (this.active || this.requests.has(key) || this.requests.size >= 1024) throw new Error("Native component request is busy or replayed");
    this.requests.add(key);
    const activeController = new AbortController();
    this.activeController = activeController;
    const combined = AbortSignal.any([this.controller.signal, activeController.signal, ...(signal ? [signal] : [])]);
    const plan = this.plans.roots[root]!;
    const run = (async () => {
      const host = await this.host(root, plan, combined);
      this.check(); combined.throwIfAborted();
      const runner = new ComponentRunner(plan, host);
      const result = await runner.run(root, parsed, combined);
      this.cleanupFailure ||= runner.cleanupFailed;
      this.check(); combined.throwIfAborted();
      return result;
    })();
    this.active = run;
    try { return await run; } finally { this.active = undefined; this.activeController = undefined; }
  }
  /** Browser detach cancels work while allowing the retained terminal to reconnect. */
  cancelActive(): void { this.activeController?.abort(); }
  close(): Promise<void> {
    this.controller.abort();
    return this.closing ??= (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([this.active?.catch(() => {}), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Native component cleanup timed out")), 5_000);
        })]);
        if (this.cleanupFailure) throw new Error("Native component cleanup failed");
      } finally { clearTimeout(timer); }
    })();
  }
}
