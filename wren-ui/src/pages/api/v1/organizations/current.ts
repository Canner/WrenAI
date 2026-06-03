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
  getCurrentProjectName,
} from '@/apollo/server/middlewares/organizationApi';

const logger = getLogger('API_CURRENT_ORGANIZATION');
logger.level = 'debug';

const getOrganizationService = () => {
  const { components } = require('@/common');
  const componentGraph = components ?? globalThis.__wrenComponents;
  if (!componentGraph) {
    throw new Error('Components are not initialized');
  }
  return componentGraph.organizationService;
};

const serializeOrganization = (organization) =>
  organization
    ? {
        id: organization.id,
        name: organization.name,
        identifier: organization.identifier,
        description: organization.description,
        isCurrent: Boolean(organization.isCurrent),
        createdAt: organization.createdAt,
        updatedAt: organization.updatedAt,
      }
    : null;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const startTime = Date.now();

  try {
    assertAllowedMethods(req, ['GET']);
    const organizationService = getOrganizationService();
    const projectContext = await getCurrentProjectContext();
    const projectId = projectContext.id ?? 0;
    const [currentOrganization, organizations, currentProjectName] =
      await Promise.all([
        organizationService.getCurrentOrganization(),
        organizationService.listOrganizations(),
        getCurrentProjectName(),
      ]);

    await respondWithSimple({
      res,
      statusCode: 200,
      responsePayload: {
        currentOrganization: serializeOrganization(currentOrganization),
        organizations: organizations.map(serializeOrganization),
        currentProjectName,
      },
      projectId,
      apiType: ApiType.GET_CURRENT_ORGANIZATION,
      startTime,
      requestPayload: {},
      headers: req.headers as Record<string, string>,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      projectId: (await getCurrentProjectContext()).id ?? 0,
      apiType: ApiType.GET_CURRENT_ORGANIZATION,
      requestPayload: {},
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
