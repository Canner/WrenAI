import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  handleApiError,
  respondWithSimple,
} from '@/apollo/server/utils/apiUtils';
import { getLogger } from '@server/utils';
import {
  assertAllowedMethods,
  getCurrentProjectName,
} from '@/apollo/server/middlewares/organizationApi';

const logger = getLogger('API_ORGANIZATIONS');
logger.level = 'debug';

const { organizationService } = components;

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

    if (req.method === 'GET') {
      const organizations = await organizationService.listOrganizations();
      await respondWithSimple({
        res,
        statusCode: 200,
        responsePayload: {
          organizations: organizations.map(serializeOrganization),
          currentProjectName: await getCurrentProjectName(),
        },
        projectId: 0,
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
      projectId: 0,
      apiType: ApiType.CREATE_ORGANIZATION,
      startTime,
      requestPayload: req.body,
      headers: req.headers as Record<string, string>,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      projectId: 0,
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
