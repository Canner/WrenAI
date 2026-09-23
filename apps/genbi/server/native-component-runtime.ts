import { isDeepStrictEqual } from "node:util";
import { hashDirectory } from "../harness/compile/fingerprint.js";
import type { ComponentAccess } from "../harness/components/broker.js";
import { normalizeComponentEvidence } from "../harness/components/normalize.js";
import { openWrenComponentAccess, type WrenAccessIdentity } from "../harness/components/wren-access.js";
import type { NativeComponentBindings } from "./native-component-preparation.js";
import { runClaudeComponentStep, type ClaudeComponentRuntime } from "./runtime-host/claude-component-step.js";
import { runCodexComponentStep, type CodexComponentPolicy } from "./runtime-host/codex-component-step.js";
import type { RpcTransport } from "./runtime-host/codex-rpc.js";

/** Injected only after vendor certification. This factory does not confer certification. */
export type NativeComponentVendor = {
  readonly authIdentity: string;
  readonly accountEmail: string;
  readonly generation: string;
  readonly models: Readonly<Record<string, string>>;
  assertCurrent(): void;
} & ({
  readonly vendor: "claude";
  open(model: string, signal: AbortSignal): Promise<ClaudeComponentRuntime>;
} | {
  readonly vendor: "codex";
  open(model: string, signal: AbortSignal): Promise<{ readonly transport: RpcTransport; readonly policy: CodexComponentPolicy }>;
});

export interface NativeComponentRuntimeOptions extends Pick<NativeComponentBindings,
  "identity" | "contexts" | "verifierBinary" | "currentIdentity" | "assertCurrent" | "persistRoot" | "onEvent"> {
  readonly vendor: NativeComponentVendor;
  readonly wren: { readonly executable: string; readonly project: string; readonly fingerprint: string; readonly identity: WrenAccessIdentity };
}

/** Bind governed steps to one approved account and captured tier map; no outer-session transport. */
export function createNativeComponentRuntimeBindings(options: NativeComponentRuntimeOptions): NativeComponentBindings {
  const identity = structuredClone(options.identity);
  const contexts = structuredClone(options.contexts);
  const provider = options.vendor;
  const vendor = provider.vendor;
  const account = { authIdentity: provider.authIdentity, accountEmail: provider.accountEmail, generation: provider.generation };
  const models = structuredClone(provider.models);
  const assertBinding = options.assertCurrent.bind(options);
  const currentIdentity = options.currentIdentity.bind(options);
  const assertVendor = provider.assertCurrent.bind(provider);
  const open = provider.open.bind(provider);
  const wren = { ...options.wren };
  const persistRoot = options.persistRoot;
  const used = new WeakSet<object>();
  const check = () => {
    assertBinding(); assertVendor();
    if (identity.vendor !== vendor || identity.auth_identity !== account.authIdentity || identity.runtime_generation !== account.generation
      || !account.accountEmail || !isDeepStrictEqual(currentIdentity(), identity)
      || provider.vendor !== vendor || provider.authIdentity !== account.authIdentity || provider.accountEmail !== account.accountEmail
      || provider.generation !== account.generation || !isDeepStrictEqual(provider.models, models)) throw new Error("Native component runtime binding expired");
  };
  check();
  const checkAccess = async (signal: AbortSignal) => { signal.throwIfAborted(); check(); await wren.identity.assertCurrent();
    if (await hashDirectory(wren.project) !== wren.fingerprint) throw new Error("Native component project changed");
    signal.throwIfAborted(); check(); };
  return {
    identity, contexts, verifierBinary: options.verifierBinary, currentIdentity, assertCurrent: check,
    ...(persistRoot ? { persistRoot: async (...args: Parameters<NonNullable<NativeComponentBindings["persistRoot"]>>) => { await checkAccess(args[2]); await persistRoot(...args); } } : {}), ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    async prepare(component, _identity, signal): Promise<ComponentAccess> {
      await checkAccess(signal);
      if (component.steps.some((step) => !models[step.tier])) throw new Error("Missing native component tier binding");
      if (component.steps.every((step) => step.tools.length === 0)) return {
        async query() { throw new Error("No component query grant"); }, async inspect() { throw new Error("No component context grant"); }, async close() {},
      };
      return openWrenComponentAccess({ ...wren, signal });
    },
    async step(run, component) {
      await checkAccess(run.signal);
      const model = models[run.tier];
      if (!model || !component.steps.some((step) => step.tier === run.tier)) throw new Error("Missing native component step binding");
      const resource = await open(model, run.signal);
      const transport = "transport" in resource ? resource.transport : resource;
      let closing: Promise<void> | undefined;
      const close = () => closing ??= transport.close();
      try {
        await checkAccess(run.signal);
        if (used.has(transport)) throw new Error("Native component step requires a fresh runtime");
        used.add(transport);
        if (vendor === "codex" && "transport" in resource) {
          if (resource.policy.accountEmail !== account.accountEmail || resource.policy.model !== model) throw new Error("Native component account or model mismatch");
          const originalCheck = resource.policy.assertCurrent.bind(resource.policy);
          return await runCodexComponentStep({ listen: resource.transport.listen.bind(resource.transport), write: resource.transport.write.bind(resource.transport), close },
            { ...resource.policy, assertCurrent() { check(); originalCheck(); } }, run);
        }
        if (vendor === "claude" && !("transport" in resource)) {
          if (resource.account.email !== account.accountEmail || resource.model !== model) throw new Error("Native component account or model mismatch");
          const originalCheck = resource.assertCurrent.bind(resource);
          return await runClaudeComponentStep({ ...resource, query: resource.query.bind(resource), close, assertCurrent() { check(); originalCheck(); } }, run);
        }
        throw new Error("Native component vendor mismatch");
      } finally { await close(); }
    },
    async normalize(component, evidence, signal, context) { await checkAccess(signal); return normalizeComponentEvidence(component, evidence, context); },
  };
}
