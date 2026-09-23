import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { generatePreparedContext, resolveContextLoader } from "../compile/context-loader.js";
import { hashDirectory } from "../compile/fingerprint.js";
import { resolveWarbleBinary } from "../compile/resolve-binary.js";
import type { TraceStep } from "../events/types.js";
import { createAgentEventEmitter } from "../events/emitter.js";
import { createDefaultProviderRegistry, resolveTierModel } from "../providers/index.js";
import { deriveAdapterSpec } from "../route/adapter-spec.js";
import type { InProcessOptions } from "../route/types.js";
import type { RunAgentResult } from "../session/types.js";
import { resolveWrenBinary } from "../tools/index.js";
import { runAiComponentStep } from "./ai-step.js";
import { createComponentBroker, type ComponentAccess } from "./broker.js";
import { normalizeComponentEvidence } from "./normalize.js";
import { planDigest } from "./plan.js";
import { ComponentRunner, type ExecutionPlan } from "./runner.js";
import { captureWrenAccessIdentity, openWrenComponentAccess } from "./wren-access.js";

const data = z.object({ columns: z.array(z.string()), rows: z.array(z.record(z.string(), z.unknown())) });

/** Executable format 0.2 path; never flattened into the legacy agent tool union. */
export async function runInProcessComponents(plan: ExecutionPlan, options: InProcessOptions): Promise<RunAgentResult> {
  if (options.mcpServers) throw new Error("Composed execution requires component-owned host bindings");
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const scratch = await mkdtemp(path.join(os.tmpdir(), "genbi-component-context-"));
  const emitter = createAgentEventEmitter(options.onEvent);
  const traceSteps: TraceStep[] = [];
  const toolOrder = new Map<string, number>();
  const entry = options.agentId ?? "answer_query";
  emitter.emit({ kind: "run.start", mode: "A", agentId: entry });
  try {
    signal.throwIfAborted();
    const project = path.resolve(options.userProject);
    const fingerprint = await hashDirectory(project);
    const accessIdentity = await captureWrenAccessIdentity(project);
    const snapshotPath = path.join(scratch, "context.json");
    await generatePreparedContext(resolveContextLoader().bin, project, snapshotPath);
    const snapshot: unknown = JSON.parse(await readFile(snapshotPath, "utf8"));
    const checkProject = async () => {
      signal.throwIfAborted();
      await accessIdentity.assertCurrent();
      if (fingerprint !== await hashDirectory(project)) { controller.abort(); throw new Error("Component project changed"); }
    };
    await checkProject();
    const contexts = Object.fromEntries(Object.values(plan.components).map((component) => {
      const binding = z.object({ project: z.string() }).passthrough().parse(component.declaration.context_binding);
      if (path.resolve(binding.project) !== project) throw new Error("Component is bound to another project");
      return [component.id, { binding, snapshot }];
    }));
    const registry = createDefaultProviderRegistry();
    const tiers = structuredClone(options.tierBinding ?? Object.fromEntries(
      Object.values(plan.components).flatMap((component) => component.steps.map((step) => [step.tier,
        deriveAdapterSpec(options.authChoice, options.model ? { model: options.model } : {})])),
    ));
    const identity = { session: randomUUID(), vendor: "in-process", account: planDigest(tiers), generation: randomUUID(),
      project, bindingRevision: planDigest([fingerprint, accessIdentity.digest]), contextDigest: planDigest(contexts), planDigest: plan.identity };
    const models = new Map<string, Map<string, ReturnType<typeof resolveTierModel>>>();
    const broker = createComponentBroker({ plan, contexts, verifierBinary: await resolveWarbleBinary(options.warbleBin),
      identity, currentIdentity: () => signal.aborted ? undefined : identity,
      async prepare(component, _identity, parent): Promise<ComponentAccess> {
        await checkProject();
        models.set(component.id, new Map([...new Set(component.steps.map((step) => step.tier))]
          .map((tier) => [tier, resolveTierModel({ tiers }, tier, registry)])));
        if (component.steps.every((step) => step.tools.length === 0)) return {
          async query() { throw new Error("No query grant"); }, async inspect() { throw new Error("No context grant"); }, async close() {},
        };
        await resolveWrenBinary();
        return openWrenComponentAccess({ executable: "wren", project, fingerprint, signal: parent, identity: accessIdentity });
      },
      async step(run, component) {
        await checkProject();
        const model = models.get(component.id)?.get(run.tier);
        if (!model) throw new Error("Missing component tier binding");
        const result = await runAiComponentStep({ ...run, prompt: [plan.systemPrompt, run.prompt].filter(Boolean).join("\n\n") }, model);
        await checkProject();
        return result;
      },
      async normalize(component, evidence) { await checkProject(); return normalizeComponentEvidence(component, evidence, contexts[component.id]?.snapshot); },
      onEvent(event) {
        if (event.callId && event.tool && event.kind === "tool.start") toolOrder.set(event.callId, toolOrder.size);
        if (event.callId && event.tool && event.kind === "tool.finish") traceSteps.push({ id: event.callId, tool: event.tool,
          outcome: event.status === "ok" ? "success" : "error", ordinal: toolOrder.get(event.callId) ?? traceSteps.length });
        if (!event.step) return;
        const stepId = `${event.invocation}:${event.step}`;
        if (event.kind === "step.start") emitter.emit({ kind: "step.start", stepId, name: event.step,
          tier: plan.components[event.component]!.steps.find((step) => step.name === event.step)!.tier,
          ...(event.parent ? { parent: event.parent } : {}), depth: event.depth });
        if (event.kind === "step.finish") emitter.emit({ kind: "step.finish", stepId, name: event.step, status: event.status === "ok" ? "ok" : "error" });
        if (event.tool && event.callId && event.kind === "tool.start") emitter.emit({ kind: "tool.call", stepId, callId: event.callId, tool: event.tool, depth: event.depth, status: "running" });
        if (event.tool && event.callId && event.kind === "tool.finish") emitter.emit({ kind: "tool.result", stepId, callId: event.callId, tool: event.tool, status: event.status === "ok" ? "success" : "error" });
      },
    });
    const result = await new ComponentRunner(plan, broker).run(entry, { request: options.question }, signal);
    if (result.status === "error") throw new Error("Component execution did not complete.");
    if (result.status !== "ok") {
      const envelope = { blocks: [], verified: false };
      emitter.emit({ kind: "refusal", reason: result.message, envelope });
      emitter.emit({ kind: "run.finish", status: "refusal" });
      return { kind: "refusal", reason: result.message, envelope, trace: { steps: traceSteps.sort((a, b) => a.ordinal - b.ordinal) } };
    }
    const value = result.output.kind === "value" ? data.safeParse(result.output.value) : undefined;
    const blocks = result.output.kind === "render" ? result.output.blocks : value?.success
      ? [{ type: "table", columns: value.data.columns, rows: value.data.rows }]
      : [{ type: "narrative", text: JSON.stringify(result.output.value) }];
    const envelope = { blocks, verified: result.provenance?.verified === true,
      ...(result.provenance?.definition ? { definition: result.provenance.definition } : {}) };
    emitter.emit({ kind: "answer", envelope });
    emitter.emit({ kind: "run.finish", status: "answer" });
    return { kind: "answer", envelope, trace: { steps: traceSteps.sort((a, b) => a.ordinal - b.ordinal) } };
  } catch (error) {
    emitter.emit({ kind: "error", message: "Component preparation or execution failed." });
    emitter.emit({ kind: "run.finish", status: "error" });
    throw error;
  } finally { controller.abort(); await rm(scratch, { recursive: true, force: true }); }
}
