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

const logger = getLogger('API_CURRENT_USER');
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
    assertAllowedMethods(req, ['GET', 'PUT']);
    const organizationMemberService = getOrganizationMemberService();
    const projectContext = await getCurrentProjectContext();
    const projectId = projectContext.id ?? 0;

    if (req.method === 'PUT') {
      const user = await organizationMemberService.updateCurrentUserProfile(
        req.body,
      );
      await respondWithSimple({
        res,
        statusCode: 200,
        responsePayload: user,
        projectId,
        apiType: ApiType.UPDATE_CURRENT_USER,
        startTime,
        requestPayload: req.body,
        headers: req.headers as Record<string, string>,
      });
      return;
    }

    const user = await organizationMemberService.getCurrentUserProfile();
    await respondWithSimple({
      res,
      statusCode: 200,
      responsePayload: user,
      projectId,
      apiType: ApiType.GET_CURRENT_USER,
      startTime,
      requestPayload: {},
      headers: req.headers as Record<string, string>,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      projectId: (await getCurrentProjectContext()).id ?? 0,
      apiType:
        req.method === 'PUT'
          ? ApiType.UPDATE_CURRENT_USER
          : ApiType.GET_CURRENT_USER,
      requestPayload: req.method === 'PUT' ? req.body : {},
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
