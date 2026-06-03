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

const logger = getLogger('API_ORGANIZATIONS');
logger.level = 'debug';

const getOrganizationService = () => {
  const { components } = require('@/common');
  const componentGraph = components ?? globalThis.__wrenComponents;
  if (!componentGraph) {
    throw new Error('Components are not initialized');
  }
  return componentGraph.organizationService;
};

const serializeOrganization = (organization) => ({
  id: organization.id,
  name: organization.name,
  identifier: organization.identifier,
  description: organization.description,
  isCurrent: Boolean(organization.isCurrent),
  createdAt: organization.createdAt,
  updatedAt: organization.updatedAt,
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const startTime = Date.now();

  try {
    assertAllowedMethods(req, ['GET', 'POST']);
    const organizationService = getOrganizationService();
    const projectContext = await getCurrentProjectContext();
    const projectId = projectContext.id ?? 0;

    if (req.method === 'GET') {
      const organizations = await organizationService.listOrganizations();
      await respondWithSimple({
        res,
        statusCode: 200,
        responsePayload: {
          organizations: organizations.map(serializeOrganization),
          currentProjectName: await getCurrentProjectName(),
        },
        projectId,
        apiType: ApiType.GET_ORGANIZATIONS,
        startTime,
        requestPayload: {},
        headers: req.headers as Record<string, string>,
      });
      return;
    }

    const organization = await organizationService.createOrganization(req.body);
    await respondWithSimple({
      res,
      statusCode: 201,
      responsePayload: serializeOrganization(organization),
      projectId,
      apiType: ApiType.CREATE_ORGANIZATION,
      startTime,
      requestPayload: req.body,
      headers: req.headers as Record<string, string>,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      projectId: (await getCurrentProjectContext()).id ?? 0,
      apiType:
        req.method === 'GET'
          ? ApiType.GET_ORGANIZATIONS
          : ApiType.CREATE_ORGANIZATION,
      requestPayload: req.method === 'GET' ? {} : req.body,
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
