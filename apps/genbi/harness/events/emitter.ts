import { randomUUID } from "node:crypto";
import type { AgentEvent } from "./types.js";

/**
 * Plain `Omit<AgentEvent, K>` does NOT distribute over the `AgentEvent`
 * union — `Omit` is `Pick<T, Exclude<keyof T, K>>`, and `keyof` of a union
 * only yields the keys common to every member, collapsing every variant-
 * specific field (`stepId`, `tool`, `envelope`, ...) down to nothing.
 * Distributing over each member first (via the naked `T extends any`
 * conditional) preserves each variant's own fields and its `kind` literal.
 */
export type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;

/**
 * What an emission site (`runAgent`, `executeAgent`) actually knows: an
 * `AgentEvent` minus the `runId`/`seq` bookkeeping that only the emitter
 * that owns the run's counter can stamp.
 */
export type AgentEventInput = DistributiveOmit<AgentEvent, "runId" | "seq">;

export interface AgentEventEmitter {
  readonly runId: string;
  /** Stamps `runId`/`seq` onto `event` and forwards it to the sink. No-op (and never throws) when no sink was given. */
  emit(event: AgentEventInput): void;
}

/**
 * Owns one run's `runId` + monotonic `seq` counter, so two independent
 * emission sites (`runAgent` for run/answer/refusal/run.finish/error;
 * `executeAgent` for step/tool/artifact) can each describe *what happened*
 * without needing to coordinate numbering themselves. `runAgent` is the
 * natural sole owner: it creates one `AgentEventEmitter` per call and passes
 * `emit` down as `ExecuteAgentContext.onEvent`.
 *
 * `sink` is the outward-facing seam (`RunAgentContext.onEvent`/
 * `RouteOptions.onEvent`), typed `(e: AgentEvent) => void` exactly as the
 * contract specifies — callers never see the bookkeeping split.
 */
export function createAgentEventEmitter(
  sink: ((event: AgentEvent) => void) | undefined,
  runId: string = randomUUID(),
): AgentEventEmitter {
  let seq = 0;
  return {
    runId,
    emit(event: AgentEventInput): void {
      if (!sink) return;
      seq += 1;
      sink({ ...event, runId, seq } as AgentEvent);
    },
  };
}
