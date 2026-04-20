import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import { AskFeedbackInput, AskFeedbackResult } from '@server/models/adaptor';

export interface TrackedTask {
  queryId: string;
  taskId?: number;
  lastPolled: number;
  result?: AskFeedbackResult;
  isFinalized: boolean;
  threadResponseId: number;
  question: string;
  originalThreadResponseId: number;
  rerun?: boolean;
  runtimeIdentity?: PersistedRuntimeIdentity;
  adjustmentPayload?: {
    originalThreadResponseId: number;
    retrievedTables: string[];
    sqlGenerationReasoning: string;
  };
}

export type TrackedAdjustmentResult = AskFeedbackResult & {
  taskId?: number;
  queryId: string;
};

export type CreateAdjustmentTaskInput = AskFeedbackInput & {
  threadId: number;
  question: string;
  originalThreadResponseId: number;
  configurations: { language: string };
  runtimeScopeId?: string | null;
  runtimeIdentity?: PersistedRuntimeIdentity;
};

export type RerunAdjustmentTaskInput = {
  threadResponseId: number;
  threadId: number;
  configurations: { language: string };
  runtimeScopeId?: string | null;
  runtimeIdentity?: PersistedRuntimeIdentity;
};

export interface IAdjustmentBackgroundTaskTracker {
  createAdjustmentTask(
    input: CreateAdjustmentTaskInput,
  ): Promise<{ queryId: string }>;
  getAdjustmentResult(queryId: string): Promise<TrackedAdjustmentResult | null>;
  getAdjustmentResultById(id: number): Promise<TrackedAdjustmentResult | null>;
  cancelAdjustmentTask(queryId: string): Promise<void>;
  rerunAdjustmentTask(
    input: RerunAdjustmentTaskInput,
  ): Promise<{ queryId: string }>;
}
