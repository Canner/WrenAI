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
  parseOrganizationId,
} from '@/apollo/server/middlewares/organizationApi';

const logger = getLogger('API_ORGANIZATION_INVITATION');
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
    const invitationId = parseOrganizationId(req.query.id);

    await organizationMemberService.removeInvitation(invitationId);
    await respondWithSimple({
      res,
      statusCode: 200,
      responsePayload: { success: true },
      projectId,
      apiType: ApiType.REMOVE_ORGANIZATION_INVITATION,
      startTime,
      requestPayload: { id: invitationId },
      headers: req.headers as Record<string, string>,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      projectId: (await getCurrentProjectContext()).id ?? 0,
      apiType: ApiType.REMOVE_ORGANIZATION_INVITATION,
      requestPayload: { id: req.query.id },
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
