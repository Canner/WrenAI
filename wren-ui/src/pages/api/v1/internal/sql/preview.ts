import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ModelController } from '@server/controllers/modelController';
import { ApiError } from '@/server/utils/apiUtils';
import { buildApiContextFromRequest } from '../../apiContext';
import { inferRestApiStatusCode } from '../../restApi';

const modelController = new ModelController();

type InternalPreviewRequest = {
  sql?: string;
  limit?: number;
  dryRun?: boolean;
  runtimeScopeId?: string;
};

const isInternalAiServiceRequest = (req: NextApiRequest) => {
  const header = req.headers['x-wren-ai-service-internal'];
  return Array.isArray(header) ? header.includes('1') : header === '1';
};

const serializePreviewError = (error: unknown) => {
  const typedError = error as
    | (Error & {
        extensions?: {
          other?: {
            correlationId?: string;
            metadata?: {
              dialectSql?: string;
              plannedSql?: string;
            };
          };
        };
      })
    | undefined;

  const other = typedError?.extensions?.other;
  return {
    error: {
      message:
        error instanceof Error && error.message
          ? error.message
          : 'SQL preview failed',
      dialectSql: other?.metadata?.dialectSql || '',
      plannedSql: other?.metadata?.plannedSql || '',
    },
    correlationId: other?.correlationId || '',
  };
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      throw new Error('Method not allowed');
    }

    if (!isInternalAiServiceRequest(req)) {
      throw new ApiError('Internal AI-service access required', 403);
    }

    const { sql, limit, dryRun, runtimeScopeId } = (req.body ||
      {}) as InternalPreviewRequest;
    if (!sql || !runtimeScopeId) {
      throw new ApiError('SQL and runtimeScopeId are required', 400);
    }

    const runtimeScope =
      await components.runtimeScopeResolver.resolveRuntimeScopeId(
        runtimeScopeId,
      );
    const ctx = await buildApiContextFromRequest({ req, runtimeScope });
    const data = await modelController.previewSql({
      data: {
        sql,
        limit,
        dryRun,
        runtimeScopeId,
      },
      ctx,
    });

    return res.status(200).json({
      data,
      correlationId:
        (data as { correlationId?: string } | null)?.correlationId || '',
    });
  } catch (error) {
    const statusCode = inferRestApiStatusCode(error);

    if (statusCode >= 500 && process.env.NODE_ENV !== 'test') {
      // eslint-disable-next-line no-console
      console.error(error);
    }
    return res.status(statusCode).json(serializePreviewError(error));
  }
}
