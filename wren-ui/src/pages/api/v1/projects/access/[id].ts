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

const logger = getLogger('API_PROJECT_ACCESS_MEMBER');
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
    assertAllowedMethods(req, ['PATCH', 'DELETE']);
    const organizationMemberService = getOrganizationMemberService();
    const projectContext = await getCurrentProjectContext();
    const projectId = projectContext.id ?? 0;
    const memberId = parseOrganizationId(req.query.id);

    if (req.method === 'PATCH') {
      const member =
        await organizationMemberService.updateProjectMemberPermission(
          memberId,
          req.body,
        );
      await respondWithSimple({
        res,
        statusCode: 200,
        responsePayload: member,
        projectId,
        apiType: ApiType.UPDATE_PROJECT_MEMBER,
        startTime,
        requestPayload: req.body,
        headers: req.headers as Record<string, string>,
      });
      return;
    }

    await organizationMemberService.removeProjectMember(memberId);
    await respondWithSimple({
      res,
      statusCode: 200,
      responsePayload: { success: true },
      projectId,
      apiType: ApiType.REMOVE_PROJECT_MEMBER,
      startTime,
      requestPayload: { id: memberId },
      headers: req.headers as Record<string, string>,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      projectId: (await getCurrentProjectContext()).id ?? 0,
      apiType:
        req.method === 'PATCH'
          ? ApiType.UPDATE_PROJECT_MEMBER
          : ApiType.REMOVE_PROJECT_MEMBER,
      requestPayload: req.method === 'PATCH' ? req.body : { id: req.query.id },
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
