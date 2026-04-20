import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import { AskInput, AskResult } from '@server/models/adaptor';

export interface TrackedTask {
  queryId: string;
  taskId?: number;
  lastPolled: number;
  question?: string;
  result?: AskResult;
  isFinalized: boolean;
  threadResponseId?: number;
  rerunFromCancelled?: boolean;
  runtimeIdentity?: PersistedRuntimeIdentity;
}

export type TrackedAskingResult = AskResult & {
  taskId?: number;
  queryId: string;
  question: string;
};

export type CreateAskingTaskInput = AskInput & {
  rerunFromCancelled?: boolean;
  previousTaskId?: number;
  threadResponseId?: number;
  runtimeIdentity?: PersistedRuntimeIdentity;
};

export interface IAskingTaskTracker {
  createAskingTask(input: CreateAskingTaskInput): Promise<{ queryId: string }>;
  getAskingResult(queryId: string): Promise<TrackedAskingResult | null>;
  getAskingResultById(id: number): Promise<TrackedAskingResult | null>;
  getTrackedRuntimeIdentity?(
    queryId: string,
  ): Promise<PersistedRuntimeIdentity | null>;
  cancelAskingTask(queryId: string): Promise<void>;
  bindThreadResponse(
    id: number,
    queryId: string,
    threadId: number,
    threadResponseId: number,
  ): Promise<void>;
}
