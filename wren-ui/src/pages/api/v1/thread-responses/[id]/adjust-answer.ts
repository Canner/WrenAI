import type { NextApiRequest, NextApiResponse } from 'next';
import { AskingController } from '@server/controllers/askingController';
import { ApiError } from '@/server/utils/apiUtils';
import { toCanonicalPersistedRuntimeIdentityFromScope } from '@server/utils/persistedRuntimeIdentity';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { sendRestApiError } from '@/server/api/restApi';
import { serializeThreadResponsePayload } from '@/server/api/threadPayloadSerializers';

const askingController = new AskingController();

const parseResponseId = (value: string | string[] | undefined) => {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(id) || id <= 0) {
    throw new ApiError('Response ID is invalid', 400);
  }
  return id;
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

    const responseId = parseResponseId(req.query.id);
    const ctx = await buildApiContextFromRequest({ req });
    const response = await askingController.adjustThreadResponse(
      null,
      {
        responseId,
        data: {
          tables: Array.isArray(req.body?.tables) ? req.body.tables : undefined,
          sqlGenerationReasoning:
            typeof req.body?.sqlGenerationReasoning === 'string'
              ? req.body.sqlGenerationReasoning
              : undefined,
          sql: typeof req.body?.sql === 'string' ? req.body.sql : undefined,
        },
      },
      ctx,
    );

    const runtimeIdentity = toCanonicalPersistedRuntimeIdentityFromScope(
      ctx.runtimeScope,
    );

    const payload = await serializeThreadResponsePayload({
      response,
      runtimeIdentity,
      services: {
        askingService: ctx.askingService,
        modelService: ctx.modelService,
        sqlPairService: ctx.sqlPairService,
      },
    });

    return res.status(200).json(payload);
  } catch (error) {
    return sendRestApiError(res, error, '调整回答失败，请稍后重试。');
  }
}
