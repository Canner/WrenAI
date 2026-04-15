import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import * as Errors from '@/apollo/server/utils/error';
import { getLogger } from '@server/utils';
import { v4 as uuidv4 } from 'uuid';
import { PreviewDataResponse } from '@server/services/queryService';
import {
  ApiError,
  respondWith,
  handleApiError,
  deriveRuntimeExecutionContextFromRequest,
} from '@/apollo/server/utils/apiUtils';
import { transformToObjects } from '@server/utils/dataUtils';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  buildAuthorizationContextFromRequest,
} from '@server/authz';

const logger = getLogger('API_RUN_SQL');
logger.level = 'debug';

const { runtimeScopeResolver, queryService, auditEventRepository } = components;

const assertKnowledgeBaseReadAccess = async ({
  req,
  runtimeScope,
}: {
  req: NextApiRequest;
  runtimeScope: any;
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

/**
 * Validates the SQL result and ensures it has the expected format
 * @param result The result to validate
 * @returns The validated result as PreviewDataResponse
 * @throws ApiError if the result is in an unexpected format
 */
const validateSqlResult = (result: any): PreviewDataResponse => {
  // Ensure we have a valid result with expected properties
  if (typeof result === 'boolean') {
    throw new ApiError('Unexpected query result format', 500);
  }

  return result as PreviewDataResponse;
};

interface RunSqlRequest {
  sql: string;
  threadId?: string;
  limit?: number;
  dryRun?: boolean;
  workspaceId?: string;
  knowledgeBaseId?: string;
  kbSnapshotId?: string;
  deployHash?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const {
    sql,
    threadId,
    limit = 1000,
    dryRun = false,
  } = req.body as RunSqlRequest;
  const startTime = Date.now();
  let runtimeScope;

  try {
    // Only allow POST method
    if (req.method !== 'POST') {
      throw new ApiError('Method not allowed', 405);
    }

    // input validation
    if (!sql) {
      throw new ApiError('SQL is required', 400);
    }

    const derivedContext = await deriveRuntimeExecutionContextFromRequest({
      req,
      runtimeScopeResolver,
      requireLatestExecutableSnapshot: true,
    });
    runtimeScope = derivedContext.runtimeScope;
    await assertKnowledgeBaseReadAccess({ req, runtimeScope });
    const { project, manifest } = derivedContext.executionContext;

    // Execute the SQL query
    try {
      const result = await queryService.preview(sql, {
        project,
        limit,
        manifest,
        modelingOnly: false,
        dryRun,
      });

      if (dryRun) {
        await respondWith({
          res,
          statusCode: 200,
          responsePayload: {
            valid: true,
          },
          runtimeScope,
          apiType: ApiType.RUN_SQL,
          startTime,
          requestPayload: req.body,
          headers: req.headers as Record<string, string>,
        });
        return;
      }

      // Validate the SQL result
      const queryResult = validateSqlResult(result);

      // Transform data into array of objects
      const transformedData = transformToObjects(
        queryResult.columns,
        queryResult.data,
      );

      // create a new thread if it's a new query
      const newThreadId = threadId || uuidv4();

      await respondWith({
        res,
        statusCode: 200,
        responsePayload: {
          records: transformedData,
          columns: queryResult.columns,
          threadId: newThreadId,
          totalRows: queryResult.data?.length || 0,
        },
        runtimeScope,
        apiType: ApiType.RUN_SQL,
        startTime,
        requestPayload: req.body,
        threadId: newThreadId,
        headers: req.headers as Record<string, string>,
      });
    } catch (queryError: unknown) {
      const queryErrorMessage =
        queryError instanceof Error
          ? queryError.message
          : 'Error executing SQL query';
      logger.error('Error executing SQL:', queryError);
      throw new ApiError(
        queryErrorMessage,
        400,
        Errors.GeneralErrorCodes.INVALID_SQL_ERROR,
      );
    }
  } catch (error) {
    await handleApiError({
      error,
      res,
      runtimeScope,
      apiType: ApiType.RUN_SQL,
      requestPayload: req.body,
      threadId,
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
