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

const logger = getLogger('API_ORGANIZATION_MEMBERS');
logger.level = 'debug';

const getBaseUrl = (req: NextApiRequest) => {
  const protocol =
    (req.headers['x-forwarded-proto'] as string | undefined) || 'http';
  const host =
    (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host;
  return `${protocol}://${host}`;
};

const withInviteLinks = (
  payload: any,
  baseUrl: string,
) => ({
  ...payload,
  invitations: payload.invitations.map((invitation) => ({
    ...invitation,
    inviteLink: `${baseUrl}/organization/invitations/${invitation.token}`,
  })),
});

const withInviteLink = <T extends { token: string }>(payload: T, baseUrl: string) => ({
  ...payload,
  inviteLink: `${baseUrl}/organization/invitations/${payload.token}`,
});

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
    assertAllowedMethods(req, ['GET', 'POST']);
    const organizationMemberService = getOrganizationMemberService();
    const projectContext = await getCurrentProjectContext();
    const projectId = projectContext.id ?? 0;

    if (req.method === 'GET') {
      const payload =
        await organizationMemberService.listCurrentOrganizationMembers();
      await respondWithSimple({
        res,
        statusCode: 200,
        responsePayload: withInviteLinks(payload, getBaseUrl(req)),
        projectId,
        apiType: ApiType.GET_ORGANIZATION_MEMBERS,
        startTime,
        requestPayload: {},
        headers: req.headers as Record<string, string>,
      });
      return;
    }

    const member = await organizationMemberService.inviteMember(req.body);
    await respondWithSimple({
      res,
      statusCode: 201,
      responsePayload: withInviteLink(member, getBaseUrl(req)),
      projectId,
      apiType: ApiType.INVITE_ORGANIZATION_MEMBER,
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
          ? ApiType.GET_ORGANIZATION_MEMBERS
          : ApiType.INVITE_ORGANIZATION_MEMBER,
      requestPayload: req.method === 'GET' ? {} : req.body,
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
