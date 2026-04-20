import { NextApiRequest, NextApiResponse } from 'next';
import * as Errors from '@/server/utils/error';
import { ApiError } from '@/server/utils/apiUtils';
import {
  ContentBlockContentType,
  ContentBlockDeltaEvent,
  ContentBlockStartEvent,
  ContentBlockStopEvent,
  EventType,
  sendSSEEvent,
} from '@/server/utils';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  buildAuthorizationContextFromRequest,
} from '@server/authz';
import { AskRuntimeIdentity } from '@/server/models/adaptor';

export const toAskRuntimeIdentity = (runtimeIdentity: {
  [K in keyof AskRuntimeIdentity]?: AskRuntimeIdentity[K] | null;
}): AskRuntimeIdentity => ({
  projectId: runtimeIdentity.projectId ?? undefined,
  workspaceId: runtimeIdentity.workspaceId ?? null,
  knowledgeBaseId: runtimeIdentity.knowledgeBaseId ?? null,
  kbSnapshotId: runtimeIdentity.kbSnapshotId ?? null,
  deployHash: runtimeIdentity.deployHash ?? null,
  actorUserId: runtimeIdentity.actorUserId ?? null,
});

export const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const getApiErrorAdditionalData = (
  error: unknown,
): Record<string, any> | undefined =>
  error instanceof ApiError ? error.additionalData : undefined;

export const getApiErrorCode = (error: unknown): Errors.GeneralErrorCodes =>
  error instanceof ApiError && error.code
    ? error.code
    : Errors.GeneralErrorCodes.INTERNAL_SERVER_ERROR;

export const assertKnowledgeBaseReadAccess = async ({
  req,
  runtimeScope,
  auditEventRepository,
}: {
  req: NextApiRequest;
  runtimeScope: any;
  auditEventRepository: any;
}) => {
  const actor = buildAuthorizationActorFromRuntimeScope(runtimeScope);
  await assertAuthorizedWithAudit({
    auditEventRepository,
    actor,
    action: 'knowledge_base.read',
    resource: {
      resourceType: runtimeScope?.knowledgeBase
        ? 'knowledge_base'
        : 'workspace',
      resourceId:
        runtimeScope?.knowledgeBase?.id || runtimeScope?.workspace?.id,
      workspaceId: runtimeScope?.workspace?.id || null,
      attributes: {
        workspaceKind: runtimeScope?.workspace?.kind || null,
        knowledgeBaseKind: runtimeScope?.knowledgeBase?.kind || null,
      },
    },
    context: buildAuthorizationContextFromRequest({
      req,
      sessionId: actor?.sessionId,
      runtimeScope,
    }),
  });
};

export const sendContentBlockStart = (
  res: NextApiResponse,
  name: ContentBlockContentType,
) => {
  const contentBlockStartEvent: ContentBlockStartEvent = {
    type: EventType.CONTENT_BLOCK_START,
    content_block: {
      type: 'text',
      name,
    },
    timestamp: Date.now(),
  };
  sendSSEEvent(res, contentBlockStartEvent);
};

export const sendContentBlockDelta = (res: NextApiResponse, text: string) => {
  const contentBlockDeltaEvent: ContentBlockDeltaEvent = {
    type: EventType.CONTENT_BLOCK_DELTA,
    delta: {
      type: 'text_delta',
      text,
    },
    timestamp: Date.now(),
  };
  sendSSEEvent(res, contentBlockDeltaEvent);
};

export const sendContentBlockStop = (res: NextApiResponse) => {
  const contentBlockStopEvent: ContentBlockStopEvent = {
    type: EventType.CONTENT_BLOCK_STOP,
    timestamp: Date.now(),
  };
  sendSSEEvent(res, contentBlockStopEvent);
};
