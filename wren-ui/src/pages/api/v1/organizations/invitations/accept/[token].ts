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

const logger = getLogger('API_ACCEPT_ORGANIZATION_INVITATION');
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
    assertAllowedMethods(req, ['POST']);
    const organizationMemberService = getOrganizationMemberService();
    const projectContext = await getCurrentProjectContext();
    const projectId = projectContext.id ?? 0;
    const token = Array.isArray(req.query.token) ? req.query.token[0] : req.query.token;

    if (!token) {
      throw new Error('Invitation token is required');
    }

    const member = await organizationMemberService.acceptInvitation(token);
    await respondWithSimple({
      res,
      statusCode: 200,
      responsePayload: member,
      projectId,
      apiType: ApiType.ACCEPT_ORGANIZATION_INVITATION,
      startTime,
      requestPayload: { token },
      headers: req.headers as Record<string, string>,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      projectId: (await getCurrentProjectContext()).id ?? 0,
      apiType: ApiType.ACCEPT_ORGANIZATION_INVITATION,
      requestPayload: { token: req.query.token },
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
