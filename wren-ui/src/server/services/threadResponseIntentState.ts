import {
  resolveResponseArtifactLineage,
  resolveResponseHomeIntent,
} from '@/features/home/thread/homeIntentContract';
import type {
  ResolvedHomeIntent,
  ResponseArtifactLineage,
} from '@/types/homeIntent';

export const buildThreadResponseIntentState = ({
  askingTaskType,
  responseKind,
  sourceResponseId,
  sql,
  threadId,
}: {
  askingTaskType?: string | null;
  responseKind?: string | null;
  sourceResponseId?: number | null;
  sql?: string | null;
  threadId: number;
}): {
  artifactLineage: ResponseArtifactLineage | null;
  resolvedIntent: ResolvedHomeIntent;
} => {
  const resolvedIntent = resolveResponseHomeIntent({
    threadId,
    responseKind,
    sourceResponseId,
    sql,
    askingTask: askingTaskType ? { type: askingTaskType } : null,
  }) ?? {
    kind: 'GENERAL_HELP',
    mode: sourceResponseId != null ? 'FOLLOW_UP' : 'NEW',
    target: 'THREAD_RESPONSE',
    source: 'derived',
    sourceThreadId: threadId,
    sourceResponseId: sourceResponseId ?? null,
    confidence: null,
    artifactPlan: null,
    conversationAidPlan: null,
  };

  const normalizedResolvedIntent: ResolvedHomeIntent =
    responseKind === 'CHART_FOLLOWUP'
      ? {
          ...resolvedIntent,
          source: 'explicit',
        }
      : resolvedIntent;

  const artifactLineage = resolveResponseArtifactLineage({
    responseKind,
    sourceResponseId,
    resolvedIntent: normalizedResolvedIntent,
  });

  return {
    artifactLineage,
    resolvedIntent: normalizedResolvedIntent,
  };
};
