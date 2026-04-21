import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import {
  getBearerToken,
  getWorkspaceSlug,
  scimError,
  scimListResponse,
} from '@server/utils/scimApi';
import {
  authorizeScimRequest,
  recordScimReadAudit,
  recordScimWriteAudit,
} from '@server/api/scim/audit';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!['GET', 'POST'].includes(String(req.method))) {
    res.setHeader('Allow', 'GET, POST');
    return scimError(res, 405, 'Method not allowed');
  }

  const bearerToken = getBearerToken(req);
  const workspaceSlug = getWorkspaceSlug(req);
  if (!bearerToken || !workspaceSlug) {
    return scimError(res, 401, 'SCIM bearer token is required');
  }

  try {
    const context = await components.scimService.authenticate({
      workspaceSlug,
      bearerToken,
    });
    await authorizeScimRequest({
      auditEventRepository: components.auditEventRepository,
      req,
      context,
      resourceType: 'identity_provider_config',
      resourceId: context.provider.id,
    });

    if (req.method === 'GET') {
      const groups = await components.scimService.listGroups(context);
      await recordScimReadAudit({
        auditEventRepository: components.auditEventRepository,
        req,
        context,
        resourceType: 'directory_group_collection',
        resourceId: context.provider.id,
        payloadJson: {
          count: groups.length,
        },
      });
      return res.status(200).json(scimListResponse(groups));
    }

    const group = await components.scimService.createGroup(
      context,
      (req.body || {}) as Record<string, any>,
    );
    await recordScimWriteAudit({
      auditEventRepository: components.auditEventRepository,
      req,
      context,
      resourceType: 'directory_group',
      resourceId: group?.id || null,
      result: 'succeeded',
      afterJson: group as any,
    });
    return res.status(201).json(group);
  } catch (error: any) {
    return scimError(
      res,
      /token/i.test(error?.message || '') ? 401 : 400,
      error?.message || 'SCIM request failed',
    );
  }
}
