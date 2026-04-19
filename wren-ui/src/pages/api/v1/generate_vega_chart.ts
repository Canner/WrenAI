import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import * as Errors from '@/server/utils/error';
import { v4 as uuidv4 } from 'uuid';
import {
  ApiError,
  respondWith,
  handleApiError,
  deriveRuntimeExecutionContextFromRequest,
  pollUntil,
} from '@/server/utils/apiUtils';
import { ChartResult, ChartStatus } from '@/server/models/adaptor';
import { PreviewDataResponse } from '@server/services/queryService';
import { transformToObjects } from '@server/utils/dataUtils';
import { toAskRuntimeIdentity } from '@server/utils/askContext';
import { applyCompatibilityApiHeaders } from '@/server/api/compatibilityApi';
import {
  canonicalizeChartSchema,
  shapeChartPreviewData,
} from '@/utils/chartSpecRuntime';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  buildAuthorizationContextFromRequest,
} from '@server/authz';

/**
 * Deprecated compatibility endpoint.
 *
 * Removal gate:
 * 1. API history shows no remaining GENERATE_VEGA_CHART usage for at least one
 *    release window / observation cycle.
 * 2. Any external callers have migrated to the ask/chart workflow.
 * 3. Then delete this route together with ApiType.GENERATE_VEGA_CHART history
 *    branches, OpenAPI exposure, and related compatibility tests.
 */

const {
  runtimeScopeResolver,
  wrenAIAdaptor,
  queryService,
  auditEventRepository,
} = components;

const DEPRECATION_WARNING =
  'Deprecated API: use the ask/chart workflow instead of /api/v1/generate_vega_chart.';

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
 * Validates the chart generation result and checks for errors
 * @param result The chart result to validate
 * @throws ApiError if the result has errors or is in a failed state
 */
const validateChartResult = (result: ChartResult): void => {
  // Check for errors or failed status
  if (result.status === ChartStatus.FAILED || result.error) {
    throw new ApiError(
      result.error?.message || 'Failed to generate Vega spec',
      400,
      Errors.GeneralErrorCodes.FAILED_TO_GENERATE_VEGA_SCHEMA,
    );
  }

  // Verify that the chartSchema is present
  if (!result?.response?.chartSchema) {
    throw new ApiError('Failed to generate Vega spec', 500);
  }
};

interface GenerateVegaSpecRequest {
  question: string;
  sql: string;
  threadId?: string;
  sampleSize?: number;
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
    sql,
    threadId,
    sampleSize = 10000,
  } = req.body as GenerateVegaSpecRequest;
  const startTime = Date.now();
  let runtimeScope;

  try {
    applyCompatibilityApiHeaders(res, {
      warning: DEPRECATION_WARNING,
    });

    // Only allow POST method
    if (req.method !== 'POST') {
      throw new ApiError('Method not allowed', 405);
    }

    // Input validation
    if (!question) {
      throw new ApiError('Question is required', 400);
    }

    if (!sql) {
      throw new ApiError('SQL is required', 400);
    }

    if (
      !Number.isInteger(sampleSize) ||
      sampleSize <= 0 ||
      sampleSize > 1000000
    ) {
      throw new ApiError('Invalid sampleSize', 400);
    }

    const derivedContext = await deriveRuntimeExecutionContextFromRequest({
      req,
      runtimeScopeResolver,
      requireLatestExecutableSnapshot: true,
    });
    runtimeScope = derivedContext.runtimeScope;
    await assertKnowledgeBaseReadAccess({ req, runtimeScope });
    const { project, language, manifest, runtimeIdentity } =
      derivedContext.executionContext;

    // Execute the SQL query to get the data
    let queryResult: PreviewDataResponse;
    try {
      queryResult = (await queryService.preview(sql, {
        project,
        limit: sampleSize,
        manifest,
        modelingOnly: false,
      })) as PreviewDataResponse;
    } catch (queryError: unknown) {
      const queryErrorMessage =
        queryError instanceof Error
          ? queryError.message
          : 'Error executing SQL query';
      throw new ApiError(
        queryErrorMessage,
        400,
        Errors.GeneralErrorCodes.INVALID_SQL_ERROR,
      );
    }

    const askRuntimeIdentity = toAskRuntimeIdentity(runtimeIdentity);

    // Ask AI service to generate a Vega spec chart
    const task = await wrenAIAdaptor.generateChart({
      query: question,
      sql,
      data: queryResult,
      runtimeScopeId: runtimeScope.selector.runtimeScopeId || undefined,
      runtimeIdentity: askRuntimeIdentity,
      configurations: {
        language,
      },
    });

    if (!task || !task.queryId) {
      throw new ApiError('Failed to start Vega spec generation task', 500);
    }

    const result = await pollUntil<ChartResult>({
      fetcher: () => wrenAIAdaptor.getChartResult(task.queryId),
      isFinished: (chartResult) =>
        chartResult.status === ChartStatus.FINISHED ||
        chartResult.status === ChartStatus.FAILED,
      timeoutError: new ApiError(
        'Timeout waiting for Vega spec generation',
        500,
        Errors.GeneralErrorCodes.POLLING_TIMEOUT,
      ),
    });

    // Validate the chart result
    validateChartResult(result);

    // Create a new thread if it's a new question
    const newThreadId = threadId || uuidv4();

    const {
      canonicalChartSchema,
      canonicalizationVersion,
      renderHints,
      validationErrors,
    } = canonicalizeChartSchema(result?.response?.chartSchema);
    const canonicalChartDetail = {
      chartSchema: canonicalChartSchema || result?.response?.chartSchema,
      rawChartSchema: result?.response?.chartSchema,
      renderHints,
    };
    const shapedPreview = shapeChartPreviewData({
      chartDetail: canonicalChartDetail,
      previewData: queryResult,
    });
    const dataObjects = transformToObjects(
      shapedPreview.previewData.columns,
      shapedPreview.previewData.data,
    );
    const enhancedVegaSpec = {
      ...(canonicalChartDetail.chartSchema || result?.response?.chartSchema),
      data: {
        values: dataObjects,
      },
    };

    // Return the Vega spec with data included
    await respondWith({
      res,
      statusCode: 200,
      responsePayload: {
        vegaSpec: enhancedVegaSpec,
        threadId: newThreadId,
        canonicalizationVersion,
        renderHints: shapedPreview.renderHints || renderHints || null,
        validationErrors,
        chartDataProfile: shapedPreview.chartDataProfile || null,
      },
      runtimeScope,
      apiType: ApiType.GENERATE_VEGA_CHART,
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
      apiType: ApiType.GENERATE_VEGA_CHART,
      requestPayload: req.body,
      threadId,
      headers: req.headers as Record<string, string>,
      startTime,
    });
  }
}
