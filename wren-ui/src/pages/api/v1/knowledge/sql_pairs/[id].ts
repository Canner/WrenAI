import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
  respondWithSimple,
  handleApiError,
  validateSql,
  deriveRuntimeExecutionContextFromRequest,
} from '@/apollo/server/utils/apiUtils';
import { getLogger } from '@server/utils';
import * as Errors from '@server/utils/error';
import {
  resolvePersistedKnowledgeBaseId,
  requirePersistedWorkspaceId,
  toCanonicalPersistedRuntimeIdentityFromScope,
} from '@server/utils/persistedRuntimeIdentity';
import {
  OUTDATED_RUNTIME_SNAPSHOT_MESSAGE,
  assertLatestExecutableRuntimeScope,
} from '@/apollo/server/utils/runtimeExecutionContext';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  buildAuthorizationContextFromRequest,
  recordAuditEvent,
} from '@server/authz';

const logger = getLogger('API_SQL_PAIR_BY_ID');
logger.level = 'debug';

const {
  runtimeScopeResolver,
  sqlPairService,
  queryService,
  knowledgeBaseRepository,
  kbSnapshotRepository,
} = components;

const assertLatestSqlPairSnapshot = async (runtimeScope: any) => {
  try {
    await assertLatestExecutableRuntimeScope({
      runtimeScope,
      knowledgeBaseRepository,
      kbSnapshotRepository,
    });
  } catch (error) {
    throw new ApiError(
      error instanceof Error
        ? error.message
        : OUTDATED_RUNTIME_SNAPSHOT_MESSAGE,
      409,
      Errors.GeneralErrorCodes.OUTDATED_RUNTIME_SNAPSHOT,
    );
  }
};

const buildKnowledgeBaseReadResource = (runtimeIdentity: any) => ({
  resourceType: 'knowledge_base' as const,
  resourceId: resolvePersistedKnowledgeBaseId(
    runtimeIdentity,
    undefined,
    'Knowledge base scope is required',
  ),
  workspaceId: requirePersistedWorkspaceId(runtimeIdentity),
});

const buildKnowledgeBaseWriteResource = (
  runtimeScope: any,
  runtimeIdentity: any,
) => ({
  ...buildKnowledgeBaseReadResource(runtimeIdentity),
  attributes: {
    workspaceKind: runtimeScope?.workspace?.kind || null,
    knowledgeBaseKind: runtimeScope?.knowledgeBase?.kind || null,
  },
});

/**
 * SQL Pairs API - Manages SQL query and question pairs for knowledge base
 */
interface UpdateSqlPairRequest {
  sql?: string;
  question?: string;
}

/**
 * Validate SQL pair ID from request query
 */
const validateSqlPairId = (id: any): number => {
  if (!id || typeof id !== 'string') {
    throw new ApiError('SQL pair ID is required', 400);
  }

  const sqlPairId = parseInt(id, 10);
  if (isNaN(sqlPairId)) {
    throw new ApiError('Invalid SQL pair ID', 400);
  }

  return sqlPairId;
};

/**
 * Handle PUT request - update an existing SQL pair
 */
const handleUpdateSqlPair = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  executionContext: any,
  startTime: number,
) => {
  await assertLatestSqlPairSnapshot(runtimeScope);
  const { id } = req.query;
  const sqlPairId = validateSqlPairId(id);
  const runtimeIdentity =
    toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
  const actor = buildAuthorizationActorFromRuntimeScope(runtimeScope);
  const auditContext = buildAuthorizationContextFromRequest({
    req,
    sessionId: actor?.sessionId,
    runtimeScope,
  });
  const resource = buildKnowledgeBaseWriteResource(
    runtimeScope,
    runtimeIdentity,
  );
  await assertAuthorizedWithAudit({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'knowledge_base.update',
    resource,
    context: auditContext,
  });

  const { sql, question } = req.body as UpdateSqlPairRequest;

  // Input validation for provided fields
  if (sql !== undefined) {
    if (!sql) {
      throw new ApiError('SQL cannot be empty', 400);
    }
    if (sql.length > 10000) {
      throw new ApiError('SQL is too long (max 10000 characters)', 400);
    }
    // Validate SQL syntax and compatibility
    await validateSql(sql, executionContext, queryService);
  }

  if (question !== undefined) {
    if (!question) {
      throw new ApiError('Question cannot be empty', 400);
    }
    if (question.length > 1000) {
      throw new ApiError('Question is too long (max 1000 characters)', 400);
    }
  }

  // Update the SQL pair
  const updatedSqlPair = await sqlPairService.updateSqlPair(
    runtimeIdentity,
    sqlPairId,
    {
      sql,
      question,
    },
  );

  await recordAuditEvent({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'knowledge_base.update',
    resource,
    result: 'succeeded',
    context: auditContext,
    afterJson: updatedSqlPair as any,
    payloadJson: {
      operation: 'sql_pair.update',
      sqlPairId,
    },
  });

  // Return the updated SQL pair directly
  await respondWithSimple({
    res,
    statusCode: 200,
    responsePayload: updatedSqlPair,
    runtimeScope,
    apiType: ApiType.UPDATE_SQL_PAIR,
    startTime,
    requestPayload: req.body,
    headers: req.headers as Record<string, string>,
  });
};

/**
 * Handle DELETE request - delete a SQL pair
 */
const handleDeleteSqlPair = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  startTime: number,
) => {
  const runtimeIdentity =
    toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
  const { id } = req.query;
  const sqlPairId = validateSqlPairId(id);
  const actor = buildAuthorizationActorFromRuntimeScope(runtimeScope);
  const auditContext = buildAuthorizationContextFromRequest({
    req,
    sessionId: actor?.sessionId,
    runtimeScope,
  });
  const resource = buildKnowledgeBaseWriteResource(
    runtimeScope,
    runtimeIdentity,
  );
  await assertAuthorizedWithAudit({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'knowledge_base.update',
    resource,
    context: auditContext,
  });

  // Delete the SQL pair
  await sqlPairService.deleteSqlPair(runtimeIdentity, sqlPairId);

  await recordAuditEvent({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'knowledge_base.update',
    resource,
    result: 'succeeded',
    context: auditContext,
    payloadJson: {
      operation: 'sql_pair.delete',
      sqlPairId,
    },
  });

  // Return 204 No Content with no payload
  await respondWithSimple({
    res,
    statusCode: 204,
    responsePayload: {},
    runtimeScope,
    apiType: ApiType.DELETE_SQL_PAIR,
    startTime,
    requestPayload: { id: sqlPairId },
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

    // Handle PUT method - update SQL pair
    if (req.method === 'PUT') {
      const derivedContext = await deriveRuntimeExecutionContextFromRequest({
        req,
        runtimeScopeResolver,
        noDeploymentMessage:
          'No deployment found, please deploy your project first',
        requireLatestExecutableSnapshot: true,
      });
      runtimeScope = derivedContext.runtimeScope;
      await handleUpdateSqlPair(
        req,
        res,
        runtimeScope,
        derivedContext.executionContext,
        startTime,
      );
      return;
    }

    // Handle DELETE method - delete SQL pair
    if (req.method === 'DELETE') {
      await handleDeleteSqlPair(req, res, runtimeScope, startTime);
      return;
    }

    // Method not allowed
    throw new ApiError('Method not allowed', 405);
  } catch (error) {
    await handleApiError({
      error,
      res,
      runtimeScope,
      apiType:
        req.method === 'PUT'
          ? ApiType.UPDATE_SQL_PAIR
          : ApiType.DELETE_SQL_PAIR,
      requestPayload: req.method === 'PUT' ? req.body : { id: req.query.id },
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
