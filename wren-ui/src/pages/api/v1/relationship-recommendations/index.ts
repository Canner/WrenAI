import type { NextApiRequest, NextApiResponse } from 'next';
import { ApiError } from '@/server/utils/apiUtils';
import { buildApiContextFromRequest } from '@/server/api/apiContext';
import { sendRestApiError } from '@/server/api/restApi';
import { toCanonicalPersistedRuntimeIdentityFromScope } from '@server/utils/persistedRuntimeIdentity';
import { toAskRuntimeIdentity } from '@server/controllers/projectControllerRuntimeSupport';
import { resolveProjectLanguage } from '@server/utils/runtimeExecutionContext';
import {
  assertExecutableRuntimeScope,
  assertKnowledgeBaseReadAccess,
} from '@server/controllers/modelControllerScopeSupport';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      throw new Error('Method not allowed');
    }

    const ctx = await buildApiContextFromRequest({ req });
    if (!ctx.runtimeScope) {
      throw new ApiError('Runtime scope is required', 400);
    }
    await assertExecutableRuntimeScope(ctx);
    await assertKnowledgeBaseReadAccess(ctx);

    const runtimeIdentity = toCanonicalPersistedRuntimeIdentityFromScope(
      ctx.runtimeScope,
    );
    const { manifest, project } =
      await ctx.mdlService.makeCurrentModelMDLByRuntimeIdentity(
        runtimeIdentity,
      );
    const result = await ctx.wrenAIAdaptor.generateRelationshipRecommendation({
      manifest,
      runtimeScopeId: ctx.runtimeScope.selector?.runtimeScopeId || undefined,
      runtimeIdentity: toAskRuntimeIdentity(runtimeIdentity),
      configurations: {
        language: resolveProjectLanguage(
          project,
          ctx.runtimeScope.knowledgeBase,
        ),
      },
    });

    return res.status(200).json({ id: result.queryId });
  } catch (error) {
    return sendRestApiError(res, error, '加载推荐关系失败，请稍后重试。');
  }
}
