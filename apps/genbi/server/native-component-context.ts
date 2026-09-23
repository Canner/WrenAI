import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { generatePreparedContext } from "../harness/compile/context-loader.js";
import { hashDirectory } from "../harness/compile/fingerprint.js";
import { captureWrenAccessIdentity } from "../harness/components/wren-access.js";
import { prepareNativeComponentHost } from "./native-component-preparation.js";
import { createNativeComponentRuntimeBindings, type NativeComponentRuntimeOptions } from "./native-component-runtime.js";
import type { NativeComponentPreparation } from "./native-components.js";

export interface NativeComponentContextOptions extends Omit<NativeComponentRuntimeOptions, "contexts" | "wren"> {
  /** All executables and the provider are resolved by the certified server provisioner. */
  readonly contextLoaderBinary: string;
  readonly wrenBinary: string;
  readonly project: string;
  readonly signal: AbortSignal;
}

/** Capture file-only context before host admission; never opens a vendor or Wren process. */
export async function prepareCapturedNativeComponentHost(
  irDocument: string, scope: Readonly<Record<string, unknown>>, options: NativeComponentContextOptions,
): Promise<NativeComponentPreparation | undefined> {
  const identity = structuredClone(options.identity);
  const capturedScope = structuredClone(scope);
  const project = path.resolve(options.project);
  const signal = options.signal;
  const currentIdentity = options.currentIdentity.bind(options);
  const assertBinding = options.assertCurrent.bind(options);
  const assertVendor = options.vendor.assertCurrent.bind(options.vendor);
  const check = () => {
    signal.throwIfAborted(); assertBinding(); assertVendor();
    if (!isDeepStrictEqual(currentIdentity(), identity)) throw new Error("Native component context binding expired");
  };
  check();
  const ir = z.object({ warble_ir_version: z.literal("0.8"), components: z.array(z.object({
    id: z.string(), context_binding: z.record(z.string(), z.unknown()).optional(),
  }).passthrough()) }).passthrough().parse(JSON.parse(irDocument));
  if (new Set(ir.components.map((component) => component.id)).size !== ir.components.length) throw new Error("Duplicate component identity");
  const fingerprint = await hashDirectory(project);
  const accessIdentity = await captureWrenAccessIdentity(project);
  check();
  const scratch = await mkdtemp(path.join(os.tmpdir(), "genbi-native-context-"));
  try {
    const snapshotPath = path.join(scratch, "context.json");
    await generatePreparedContext(options.contextLoaderBinary, project, snapshotPath, signal);
    const snapshot = z.object({ context_version: z.literal(2), parseable: z.literal(true) }).passthrough()
      .parse(JSON.parse(await readFile(snapshotPath, "utf8")));
    await accessIdentity.assertCurrent();
    if (fingerprint !== await hashDirectory(project)) throw new Error("Native component project changed during context capture");
    check();
    const contexts = Object.fromEntries(ir.components.flatMap((component) => {
      const binding = component.context_binding;
      // Other, unreachable components cannot contribute a project or context grant.
      // Preparation below requires a captured context for every reachable component.
      if (!binding || typeof binding.project !== "string" || path.resolve(binding.project) !== project) return [];
      return [[component.id, { binding, snapshot }]];
    }));
    const bindings = createNativeComponentRuntimeBindings({ ...options, identity, contexts, currentIdentity, assertCurrent: check,
      wren: { executable: options.wrenBinary, project, fingerprint, identity: accessIdentity } });
    return prepareNativeComponentHost(irDocument, capturedScope, bindings);
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
