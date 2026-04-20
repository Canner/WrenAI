import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import type { CreateModelData } from '@server/models/model';
import { ModelController } from '@server/controllers/modelController';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
  respondWithSimple,
  handleApiError,
  deriveRuntimeExecutionContextFromRequest,
} from '@/server/utils/apiUtils';
import { getLogger } from '@server/utils';
import { buildApiContextFromRequest } from '@/server/api/apiContext';

const logger = getLogger('API_MODELS');
logger.level = 'debug';
const modelController = new ModelController();

const { runtimeScopeResolver } = components;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const startTime = Date.now();
  let runtimeScope;

  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      throw new ApiError('Method not allowed', 405);
    }

    if (req.method === 'POST') {
      const fields = Array.isArray(req.body?.fields) ? req.body.fields : [];
      const sourceTableName = String(req.body?.sourceTableName || '').trim();
      const primaryKey = String(req.body?.primaryKey || '').trim();
      const connectorId =
        typeof req.body?.connectorId === 'string'
          ? req.body.connectorId.trim() || null
          : null;
      if (!sourceTableName || fields.length === 0 || !primaryKey) {
        throw new ApiError('Model payload is invalid', 400);
      }

      runtimeScope = await runtimeScopeResolver.resolveRequestScope(req);
      const ctx = await buildApiContextFromRequest({ req, runtimeScope });
      const data: CreateModelData = {
        connectorId,
        sourceTableName,
        fields: fields as [string],
        primaryKey,
      };
      const model = await modelController.createModel({ data, ctx });

      await respondWithSimple({
        res,
        statusCode: 201,
        responsePayload: model,
        runtimeScope,
        apiType: ApiType.GET_MODELS,
        startTime,
        requestPayload:
          req.body && typeof req.body === 'object' ? req.body : {},
        headers: req.headers as Record<string, string>,
      });
      return;
    }

    const derivedContext = await deriveRuntimeExecutionContextFromRequest({
      req,
      runtimeScopeResolver,
    });
    runtimeScope = derivedContext.runtimeScope;
    const { deployment: lastDeploy } = derivedContext.executionContext;

    // Get the MDL from the deployment manifest
    const mdl = lastDeploy.manifest as any;

    // Extract models, views, and relationships from the MDL with defaults
    const models = mdl?.models || [];
    const views = mdl?.views || [];
    const relationships = mdl?.relationships || [];

    // Return the restructured response
    await respondWithSimple({
      res,
      statusCode: 200,
      responsePayload: {
        hash: lastDeploy.hash,
        models,
        relationships,
        views,
      },
      runtimeScope,
      apiType: ApiType.GET_MODELS,
      startTime,
      headers: req.headers as Record<string, string>,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      runtimeScope,
      apiType: ApiType.GET_MODELS,
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
