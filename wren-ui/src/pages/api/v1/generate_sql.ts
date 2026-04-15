import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import { AskResult } from '@/apollo/server/models/adaptor';
import * as Errors from '@/apollo/server/utils/error';
import { getLogger } from '@server/utils';
import { v4 as uuidv4 } from 'uuid';
import {
  ApiError,
  respondWith,
  handleApiError,
  isAskResultFinished,
  validateAskResult,
  transformHistoryInput,
  deriveRuntimeExecutionContextFromRequest,
  getScopedThreadHistories,
  pollUntil,
} from '@/apollo/server/utils/apiUtils';
import {
  buildAskRuntimeContext,
  toAskRuntimeIdentity,
} from '@server/utils/askContext';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  buildAuthorizationContextFromRequest,
} from '@server/authz';
import { DataSourceName } from '@server/types';

const logger = getLogger('API_GENERATE_SQL');
logger.level = 'debug';

const {
  apiHistoryRepository,
  runtimeScopeResolver,
  wrenAIAdaptor,
  wrenEngineAdaptor,
  ibisAdaptor,
  skillService,
  auditEventRepository,
} = components;

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

interface GenerateSqlRequest {
  question: string;
  threadId?: string;
  language?: string;
  returnSqlDialect?: boolean;
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
    question,
    threadId,
    language,
    returnSqlDialect = false,
  } = req.body as GenerateSqlRequest;
  const startTime = Date.now();
  let runtimeScope;

  try {
    // Only allow POST method
    if (req.method !== 'POST') {
      throw new ApiError('Method not allowed', 405);
    }

    // input validation
    if (!question) {
      throw new ApiError('Question is required', 400);
    }

    const derivedContext = await deriveRuntimeExecutionContextFromRequest({
      req,
      runtimeScopeResolver,
      noDeploymentMessage: 'No deployment found, please deploy a model first',
      requireLatestExecutableSnapshot: true,
    });
    runtimeScope = derivedContext.runtimeScope;
    await assertKnowledgeBaseReadAccess({ req, runtimeScope });
    const {
      project,
      deployment,
      language: runtimeLanguage,
      runtimeIdentity,
    } = derivedContext.executionContext;
    const deployId = runtimeScope.deployHash || deployment.hash;
    if (!deployId) {
      throw new ApiError(
        'No deployment found, please deploy a model first',
        400,
      );
    }

    // ask AI service to generate SQL
    const histories = await getScopedThreadHistories({
      apiHistoryRepository,
      threadId,
      runtimeScope,
    });
    const askRuntimeContext = await buildAskRuntimeContext({
      runtimeIdentity: toAskRuntimeIdentity({
        ...runtimeIdentity,
        deployHash: runtimeIdentity.deployHash || deployId,
      }),
      skillService,
    });
    const task = await wrenAIAdaptor.ask({
      query: question,
      deployId,
      histories: transformHistoryInput(histories) as any,
      configurations: {
        language: language || runtimeLanguage,
      },
      ...askRuntimeContext,
    });

    const result = await pollUntil<AskResult>({
      fetcher: () => wrenAIAdaptor.getAskResult(task.queryId),
      isFinished: isAskResultFinished,
      timeoutError: new ApiError(
        'Timeout waiting for SQL generation',
        500,
        Errors.GeneralErrorCodes.POLLING_TIMEOUT,
      ),
    });

    // Validate the AI result
    validateAskResult(result, task.queryId);

    // Get the generated SQL
    let sql = result.response?.[0]?.sql;

    // Create a new thread if it's a new question
    const newThreadId = threadId || uuidv4();

    // If returnSqlDialect is true, also get and return the native SQL
    if (returnSqlDialect && sql) {
      let nativeSql: string;
      if (project.type === DataSourceName.DUCKDB) {
        nativeSql = await wrenEngineAdaptor.getNativeSQL(sql, {
          manifest: deployment.manifest,
          modelingOnly: false,
        });
      } else {
        nativeSql = await ibisAdaptor.getNativeSql({
          dataSource: project.type,
          sql,
          mdl: deployment.manifest,
        });
      }

      // If the native SQL is not empty, use it
      sql = nativeSql || sql;
    }

    // Return just the SQL
    await respondWith({
      res,
      statusCode: 200,
      responsePayload: {
        sql,
        threadId: newThreadId,
      },
      runtimeScope,
      apiType: ApiType.GENERATE_SQL,
      startTime,
      requestPayload: req.body,
      threadId: newThreadId,
      headers: req.headers as Record<string, string>,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      runtimeScope,
      apiType: ApiType.GENERATE_SQL,
      requestPayload: req.body,
      threadId,
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
