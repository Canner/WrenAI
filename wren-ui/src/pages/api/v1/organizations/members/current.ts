import { NextApiRequest, NextApiResponse } from 'next';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  handleApiError,
  respondWithSimple,
} from '@/apollo/server/utils/apiUtils';
import { getLogger } from '@server/utils';
import {
  assertAllowedMethods,
  getCurrentProjectContext,
} from '@/apollo/server/middlewares/organizationApi';

const logger = getLogger('API_CURRENT_ORGANIZATION_MEMBER');
logger.level = 'debug';

const getOrganizationMemberService = () => {
  const { components } = require('@/common');
  const componentGraph = components ?? globalThis.__wrenComponents;
  if (!componentGraph) {
    throw new Error('Components are not initialized');
  }
  return componentGraph.organizationMemberService;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const startTime = Date.now();

  try {
    assertAllowedMethods(req, ['DELETE']);
    const organizationMemberService = getOrganizationMemberService();
    const projectContext = await getCurrentProjectContext();
    const projectId = projectContext.id ?? 0;

    await organizationMemberService.leaveCurrentOrganization();
    await respondWithSimple({
      res,
      statusCode: 200,
      responsePayload: { success: true },
      projectId,
      apiType: ApiType.LEAVE_ORGANIZATION,
      startTime,
      requestPayload: {},
      headers: req.headers as Record<string, string>,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      projectId: (await getCurrentProjectContext()).id ?? 0,
      apiType: ApiType.LEAVE_ORGANIZATION,
      requestPayload: {},
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
