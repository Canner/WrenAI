import type { ThreadResponse } from '@/types/home';
import type {
  InlineArtifactKind,
  WorkbenchArtifactKind,
} from '@/types/homeIntent';
import {
  resolveResponseArtifactLineage,
  resolveResponseArtifactPlan,
} from './homeIntentContract';

export type {
  InlineArtifactKind,
  WorkbenchArtifactKind,
} from '@/types/homeIntent';

export const hasResponseChartArtifact = (response?: ThreadResponse | null) =>
  resolveResponseArtifactPlan(response).workbenchArtifacts.includes('chart');

export const hasResponsePreviewArtifact = (response?: ThreadResponse | null) =>
  resolveResponseArtifactPlan(response).workbenchArtifacts.includes('preview');

export const hasResponseSqlArtifact = (response?: ThreadResponse | null) =>
  resolveResponseArtifactPlan(response).workbenchArtifacts.includes('sql');

export const isRenderableWorkbenchArtifact = (
  response: ThreadResponse | null | undefined,
  artifact: WorkbenchArtifactKind,
) =>
  resolveResponseArtifactPlan(response).workbenchArtifacts.includes(artifact);

export const resolveResponseWorkbenchArtifacts = (
  response?: ThreadResponse | null,
): WorkbenchArtifactKind[] =>
  resolveResponseArtifactPlan(response).workbenchArtifacts;

export const resolveResponseTeasers = (
  response?: ThreadResponse | null,
): InlineArtifactKind[] =>
  resolveResponseArtifactPlan(response).teaserArtifacts;

export const resolvePrimaryWorkbenchArtifact = (
  response?: ThreadResponse | null,
): WorkbenchArtifactKind | null =>
  resolveResponseArtifactPlan(response).primaryWorkbenchArtifact || null;

export const resolveFallbackWorkbenchArtifact = (
  response?: ThreadResponse | null,
): WorkbenchArtifactKind | null => resolvePrimaryWorkbenchArtifact(response);

export const hasRenderableWorkbenchArtifacts = (
  response?: ThreadResponse | null,
) => resolveResponseWorkbenchArtifacts(response).length > 0;

export const resolveWorkbenchArtifactOwnerResponse = ({
  artifact,
  responses,
  selectedResponse,
}: {
  artifact?: WorkbenchArtifactKind | null;
  responses: ThreadResponse[];
  selectedResponse?: ThreadResponse | null;
}) => {
  if (!selectedResponse || !artifact) {
    return selectedResponse || null;
  }

  const artifactLineage = resolveResponseArtifactLineage(selectedResponse);
  const inheritedArtifacts = artifactLineage?.inheritedWorkbenchArtifacts || [];
  const sourceResponseId = artifactLineage?.sourceResponseId ?? null;

  if (
    !inheritedArtifacts.includes(artifact) ||
    typeof sourceResponseId !== 'number'
  ) {
    return selectedResponse;
  }

  return (
    responses.find((response) => response.id === sourceResponseId) ||
    selectedResponse
  );
};

export const findExistingChartFollowUpResponse = ({
  responses,
  sourceResponseId,
}: {
  responses: ThreadResponse[];
  sourceResponseId: number;
}) =>
  [...responses]
    .reverse()
    .find((response) =>
      response.resolvedIntent?.kind === 'CHART'
        ? response.artifactLineage?.sourceResponseId === sourceResponseId ||
          response.sourceResponseId === sourceResponseId
        : response.responseKind === 'CHART_FOLLOWUP' &&
          response.sourceResponseId === sourceResponseId,
    ) || null;
