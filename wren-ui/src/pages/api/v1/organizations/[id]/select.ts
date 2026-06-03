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

const logger = getLogger('API_SELECT_ORGANIZATION');
logger.level = 'debug';

const getOrganizationService = () => {
  const { components } = require('@/common');
  const componentGraph = components ?? globalThis.__wrenComponents;
  if (!componentGraph) {
    throw new Error('Components are not initialized');
  }
  return componentGraph.organizationService;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const startTime = Date.now();

  try {
    assertAllowedMethods(req, ['POST']);
    const organizationService = getOrganizationService();
    const projectContext = await getCurrentProjectContext();
    const projectId = projectContext.id ?? 0;
    const organizationId = parseOrganizationId(req.query.id);
    const organization =
      await organizationService.selectCurrentOrganization(organizationId);

    await respondWithSimple({
      res,
      statusCode: 200,
      responsePayload: {
        id: organization.id,
        name: organization.name,
        identifier: organization.identifier,
        description: organization.description,
        isCurrent: Boolean(organization.isCurrent),
        createdAt: organization.createdAt,
        updatedAt: organization.updatedAt,
      },
      projectId,
      apiType: ApiType.SELECT_ORGANIZATION,
      startTime,
      requestPayload: { id: organizationId },
      headers: req.headers as Record<string, string>,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      projectId: (await getCurrentProjectContext()).id ?? 0,
      apiType: ApiType.SELECT_ORGANIZATION,
      requestPayload: { id: req.query.id },
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
