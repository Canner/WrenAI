import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
  handleApiError,
  respondWithSimple,
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

const logger = getLogger('API_KNOWLEDGE_BASE_BY_ID');
logger.level = 'debug';

const { runtimeScopeResolver, knowledgeBaseService, kbSnapshotRepository } =
  components;

interface UpdateKnowledgeBaseRequest {
  name?: string;
  description?: string | null;
  defaultKbSnapshotId?: string | null;
  primaryConnectorId?: string | null;
  language?: string | null;
  sampleDataset?: string | null;
  archivedAt?: string | null;
}

const getQueryString = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const normalizeNullableString = (
  value: unknown,
  fieldName: string,
): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new ApiError(`${fieldName} must be a string or null`, 400);
  }

  return value.trim() || null;
};

const normalizeName = (value: unknown) => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ApiError('Knowledge base name must be a string', 400);
  }

  const normalizedValue = value.trim();
  if (!normalizedValue) {
    throw new ApiError('Knowledge base name cannot be empty', 400);
  }

  return normalizedValue;
};

const normalizeNullableDate = (
  value: unknown,
  fieldName: string,
): Date | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new ApiError(`${fieldName} must be a string or null`, 400);
  }

  const normalizedValue = new Date(value);
  if (Number.isNaN(normalizedValue.getTime())) {
    throw new ApiError(`${fieldName} must be a valid ISO date string`, 400);
  }

  return normalizedValue;
};

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
    recommendationQueryId: knowledgeBase.recommendationQueryId ?? null,
    recommendationStatus: knowledgeBase.recommendationStatus ?? null,
    recommendationQuestions: knowledgeBase.recommendationQuestions ?? null,
    recommendationError: knowledgeBase.recommendationError ?? null,
    createdBy: knowledgeBase.createdBy ?? null,
    createdAt: knowledgeBase.createdAt ?? null,
    updatedAt: knowledgeBase.updatedAt ?? null,
    archivedAt: knowledgeBase.archivedAt ?? null,
    snapshotCount: snapshots.length,
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

const getScopedKnowledgeBase = async (
  workspaceId: string,
  knowledgeBaseId: string,
  actor?: ReturnType<typeof buildAuthorizationActorFromRuntimeScope> | null,
) => {
  const knowledgeBase = await knowledgeBaseService.getKnowledgeBaseById(
    workspaceId,
    knowledgeBaseId,
    actor
      ? {
          actor,
        }
      : undefined,
  );

  if (!knowledgeBase) {
    throw new ApiError('Knowledge base not found', 404);
  }

  return knowledgeBase;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const startTime = Date.now();
  let runtimeScope;

  try {
    runtimeScope = await runtimeScopeResolver.resolveRequestScope(req);
    const runtimeIdentity =
      toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
    const workspaceId = requirePersistedWorkspaceId(runtimeIdentity);
    const knowledgeBaseId = getQueryString(req.query.id)?.trim();

    if (!knowledgeBaseId) {
      throw new ApiError('Knowledge base id is required', 400);
    }

    if (!['GET', 'PATCH'].includes(req.method || '')) {
      res.setHeader('Allow', 'GET, PATCH');
      throw new ApiError('Method not allowed', 405);
    }

    const actor = buildAuthorizationActorFromRuntimeScope(runtimeScope);
    const knowledgeBase = await getScopedKnowledgeBase(
      workspaceId,
      knowledgeBaseId,
      actor,
    );
    const auditContext = buildAuthorizationContextFromRequest({
      req,
      sessionId: actor?.sessionId,
      runtimeScope,
    });

    if (req.method === 'GET') {
      if (knowledgeBase.archivedAt) {
        throw new ApiError('Knowledge base not found', 404);
      }
      await assertAuthorizedWithAudit({
        auditEventRepository: components.auditEventRepository,
        actor,
        action: 'knowledge_base.read',
        resource: {
          resourceType: 'knowledge_base',
          resourceId: knowledgeBase.id,
          workspaceId,
        },
        context: auditContext,
      });
      await respondWithSimple({
        res,
        statusCode: 200,
        responsePayload: await toKnowledgeBaseResponse(knowledgeBase),
        runtimeScope,
        apiType: ApiType.GET_KNOWLEDGE_BASES,
        startTime,
        requestPayload: { id: knowledgeBaseId },
        headers: req.headers as Record<string, string>,
      });
      return;
    }

    const payload = (req.body || {}) as UpdateKnowledgeBaseRequest;
    const updateAction =
      payload.archivedAt !== undefined
        ? 'knowledge_base.archive'
        : 'knowledge_base.update';
    await assertAuthorizedWithAudit({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: updateAction,
      resource: {
        resourceType: 'knowledge_base',
        resourceId: knowledgeBase.id,
        workspaceId,
        attributes: {
          workspaceKind: runtimeScope?.workspace?.kind || null,
          knowledgeBaseKind: knowledgeBase.kind || null,
        },
      },
      context: auditContext,
    });
    const updatedKnowledgeBase = await knowledgeBaseService.updateKnowledgeBase(
      {
        knowledgeBaseId: knowledgeBase.id,
        workspaceId,
        name: normalizeName(payload.name),
        description: normalizeNullableString(
          payload.description,
          'Knowledge base description',
        ),
        defaultKbSnapshotId: normalizeNullableString(
          payload.defaultKbSnapshotId,
          'Default knowledge base snapshot id',
        ),
        primaryConnectorId: normalizeNullableString(
          payload.primaryConnectorId,
          'Primary connector id',
        ),
        language: normalizeNullableString(payload.language, 'Language'),
        sampleDataset: normalizeNullableString(
          payload.sampleDataset,
          'Sample dataset',
        ),
        archivedAt: normalizeNullableDate(payload.archivedAt, 'Archived at'),
        authorization: {
          actor: actor!,
        },
      },
    );

    await recordAuditEvent({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: updateAction,
      resource: {
        resourceType: 'knowledge_base',
        resourceId: knowledgeBase.id,
        workspaceId,
      },
      result: 'succeeded',
      context: auditContext,
      beforeJson: knowledgeBase as any,
      afterJson: updatedKnowledgeBase as any,
    });

    await respondWithSimple({
      res,
      statusCode: 200,
      responsePayload: await toKnowledgeBaseResponse(updatedKnowledgeBase),
      runtimeScope,
      apiType: ApiType.UPDATE_KNOWLEDGE_BASE,
      startTime,
      requestPayload: req.body ?? {},
      headers: req.headers as Record<string, string>,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      runtimeScope,
      apiType:
        req.method === 'GET'
          ? ApiType.GET_KNOWLEDGE_BASES
          : ApiType.UPDATE_KNOWLEDGE_BASE,
      requestPayload:
        req.method === 'GET' ? { id: req.query.id } : req.body ?? {},
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
