import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  handleApiError,
  respondWithSimple,
  ApiError,
} from '@/server/utils/apiUtils';
import { getLogger } from '@server/utils';
import {
  requirePersistedWorkspaceId,
  toCanonicalPersistedRuntimeIdentityFromScope,
} from '@server/utils/persistedRuntimeIdentity';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  buildAuthorizationContextFromRequest,
  recordAuditEvent,
} from '@server/authz';
import { resolveKnowledgeBaseAssetCount } from '@server/utils/knowledgeBaseAssetMetrics';

const logger = getLogger('API_KNOWLEDGE_BASES');
logger.level = 'debug';

const { runtimeScopeResolver, knowledgeBaseService, kbSnapshotRepository } =
  components;

interface CreateKnowledgeBaseRequest {
  name: string;
  description?: string | null;
  slug?: string | null;
}

const toKnowledgeBaseResponse = async (knowledgeBase: any) => {
  const [defaultKbSnapshot, snapshots, primaryConnector] = await Promise.all([
    knowledgeBase.defaultKbSnapshotId
      ? kbSnapshotRepository.findOneBy({
          id: knowledgeBase.defaultKbSnapshotId,
        })
      : Promise.resolve(null),
    kbSnapshotRepository.findAllBy({
      knowledgeBaseId: knowledgeBase.id,
    }),
    knowledgeBaseService.getPrimaryConnector(knowledgeBase),
  ]);
  const assetCount = await resolveKnowledgeBaseAssetCount({
    knowledgeBase,
    defaultSnapshot: defaultKbSnapshot,
    kbSnapshotRepository,
    modelRepository: components.modelRepository,
    viewRepository: components.viewRepository,
  });

  return {
    id: knowledgeBase.id,
    workspaceId: knowledgeBase.workspaceId,
    slug: knowledgeBase.slug,
    name: knowledgeBase.name,
    kind: knowledgeBase.kind ?? 'regular',
    description: knowledgeBase.description ?? null,
    defaultKbSnapshotId: knowledgeBase.defaultKbSnapshotId ?? null,
    primaryConnectorId: knowledgeBase.primaryConnectorId ?? null,
    runtimeProjectId: knowledgeBase.runtimeProjectId ?? null,
    language: knowledgeBase.language ?? null,
    sampleDataset: knowledgeBase.sampleDataset ?? null,
    createdBy: knowledgeBase.createdBy ?? null,
    createdAt: knowledgeBase.createdAt ?? null,
    updatedAt: knowledgeBase.updatedAt ?? null,
    snapshotCount: snapshots.length,
    assetCount,
    defaultKbSnapshot: defaultKbSnapshot
      ? {
          id: defaultKbSnapshot.id,
          snapshotKey: defaultKbSnapshot.snapshotKey,
          displayName: defaultKbSnapshot.displayName,
          deployHash: defaultKbSnapshot.deployHash,
          status: defaultKbSnapshot.status,
        }
      : null,
    primaryConnector: primaryConnector
      ? {
          id: primaryConnector.id,
          workspaceId: primaryConnector.workspaceId,
          knowledgeBaseId: primaryConnector.knowledgeBaseId ?? null,
          type: primaryConnector.type,
          databaseProvider: primaryConnector.databaseProvider ?? null,
          trinoCatalogName: primaryConnector.trinoCatalogName ?? null,
          displayName: primaryConnector.displayName,
          hasSecret: Boolean(primaryConnector.secretRecordId),
        }
      : null,
  };
};

const handleListKnowledgeBases = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  startTime: number,
) => {
  const runtimeIdentity =
    toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
  const workspaceId = requirePersistedWorkspaceId(runtimeIdentity);
  const actor = buildAuthorizationActorFromRuntimeScope(runtimeScope);
  await assertAuthorizedWithAudit({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'knowledge_base.read',
    resource: {
      resourceType: 'workspace',
      resourceId: workspaceId,
      workspaceId,
    },
    context: buildAuthorizationContextFromRequest({
      req,
      sessionId: actor?.sessionId,
      runtimeScope,
    }),
  });
  const knowledgeBases = (
    await knowledgeBaseService.listKnowledgeBases(workspaceId, {
      actor: actor!,
    })
  )
    .filter((knowledgeBase) => !knowledgeBase.archivedAt)
    .sort(
      (left, right) =>
        new Date(right.updatedAt || 0).getTime() -
        new Date(left.updatedAt || 0).getTime(),
    );

  const responsePayload = await Promise.all(
    knowledgeBases.map(toKnowledgeBaseResponse),
  );

  await respondWithSimple({
    res,
    statusCode: 200,
    responsePayload,
    runtimeScope,
    apiType: ApiType.GET_KNOWLEDGE_BASES,
    startTime,
    requestPayload: {},
    headers: req.headers as Record<string, string>,
  });
};

const handleCreateKnowledgeBase = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  startTime: number,
) => {
  const runtimeIdentity =
    toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
  const workspaceId = requirePersistedWorkspaceId(runtimeIdentity);
  const actor = buildAuthorizationActorFromRuntimeScope(runtimeScope);
  const auditContext = buildAuthorizationContextFromRequest({
    req,
    sessionId: actor?.sessionId,
    runtimeScope,
  });
  await assertAuthorizedWithAudit({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'knowledge_base.create',
    resource: {
      resourceType: 'workspace',
      resourceId: workspaceId,
      workspaceId,
      attributes: {
        workspaceKind: runtimeScope?.workspace?.kind ?? null,
      },
    },
    context: auditContext,
  });
  const payload = (req.body || {}) as Partial<CreateKnowledgeBaseRequest>;
  const name = payload.name?.trim();
  const description = payload.description?.trim() || null;

  if (!name) {
    throw new ApiError('Knowledge base name is required', 400);
  }

  const knowledgeBase = await knowledgeBaseService.createKnowledgeBase({
    workspaceId,
    name,
    description,
    slug: payload.slug,
    createdBy: runtimeIdentity.actorUserId || null,
    authorization: {
      actor: actor!,
    },
  });

  await recordAuditEvent({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'knowledge_base.create',
    resource: {
      resourceType: 'knowledge_base',
      resourceId: knowledgeBase.id,
      workspaceId,
    },
    result: 'succeeded',
    context: auditContext,
    afterJson: knowledgeBase as any,
  });

  await respondWithSimple({
    res,
    statusCode: 201,
    responsePayload: await toKnowledgeBaseResponse(knowledgeBase),
    runtimeScope,
    apiType: ApiType.CREATE_KNOWLEDGE_BASE,
    startTime,
    requestPayload: req.body,
    headers: req.headers as Record<string, string>,
  });
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const startTime = Date.now();
  let runtimeScope;

  try {
    runtimeScope = await runtimeScopeResolver.resolveRequestScope(req);

    if (req.method === 'GET') {
      await handleListKnowledgeBases(req, res, runtimeScope, startTime);
      return;
    }

    if (req.method === 'POST') {
      await handleCreateKnowledgeBase(req, res, runtimeScope, startTime);
      return;
    }

    throw new ApiError('Method not allowed', 405);
  } catch (error) {
    await handleApiError({
      error,
      res,
      runtimeScope,
      apiType:
        req.method === 'GET'
          ? ApiType.GET_KNOWLEDGE_BASES
          : ApiType.CREATE_KNOWLEDGE_BASE,
      requestPayload: req.method === 'GET' ? {} : req.body,
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
