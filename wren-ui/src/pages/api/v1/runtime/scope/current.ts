import type { NextApiRequest, NextApiResponse } from 'next';
import { RuntimeSelectorController } from '@server/controllers/runtimeSelectorController';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { sendRestApiError } from '@/server/api/restApi';

const runtimeSelectorController = new RuntimeSelectorController();
const RUNTIME_SCOPE_BOOTSTRAP_FALLBACK_ERRORS = new Set([
  'Workspace scope could not be resolved',
  'No deployment found for the requested runtime scope',
  'Session workspace does not match requested workspace',
]);

const shouldRetryWithoutRuntimeScope = (error: unknown) =>
  Boolean(
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string' &&
    RUNTIME_SCOPE_BOOTSTRAP_FALLBACK_ERRORS.has(error.message),
  );

const buildRuntimeSelectorApiContext = async (req: NextApiRequest) => {
  try {
    return await buildApiContextFromRequest({
      req,
      allowMissingRuntimeScope: true,
    });
  } catch (error) {
    if (!shouldRetryWithoutRuntimeScope(error)) {
      throw error;
    }

    return buildApiContextFromRequest({
      req,
      runtimeScope: null,
      allowMissingRuntimeScope: true,
    });
  }
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      throw new Error('Method not allowed');
    }

    const ctx = await buildRuntimeSelectorApiContext(req);
    const result = await runtimeSelectorController.getRuntimeSelectorState({
      ctx,
    });

    return res.status(200).json(result);
  } catch (error) {
    return sendRestApiError(res, error, '加载运行时范围失败，请稍后重试。');
  }
}
