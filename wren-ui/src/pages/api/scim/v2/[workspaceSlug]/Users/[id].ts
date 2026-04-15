import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import {
  getBearerToken,
  getWorkspaceSlug,
  scimError,
} from '@server/utils/scimApi';
import {
  authorizeScimRequest,
  recordScimReadAudit,
  recordScimWriteAudit,
} from '../../../audit';

const getId = (req: NextApiRequest) => {
  const value = req.query.id;
  return Array.isArray(value) ? value[0] : value;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!['GET', 'PUT', 'PATCH', 'DELETE'].includes(String(req.method))) {
    res.setHeader('Allow', 'GET, PUT, PATCH, DELETE');
    return scimError(res, 405, 'Method not allowed');
  }

  const bearerToken = getBearerToken(req);
  const workspaceSlug = getWorkspaceSlug(req);
  const id = getId(req);
  if (!bearerToken || !workspaceSlug) {
    return scimError(res, 401, 'SCIM bearer token is required');
  }
  if (!id) {
    return scimError(res, 400, 'SCIM user id is required');
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
      resourceType: 'scim_user',
      resourceId: id,
    });

    if (req.method === 'GET') {
      const user = await components.scimService.getUser(context, id);
      if (!user) {
        return scimError(res, 404, 'User not found');
      }
      await recordScimReadAudit({
        auditEventRepository: components.auditEventRepository,
        req,
        context,
        resourceType: 'scim_user',
        resourceId: id,
      });
      return res.status(200).json(user);
    }

    if (req.method === 'PUT') {
      const user = await components.scimService.replaceUser(
        context,
        id,
        (req.body || {}) as Record<string, any>,
      );
      await recordScimWriteAudit({
        auditEventRepository: components.auditEventRepository,
        req,
        context,
        resourceType: 'scim_user',
        resourceId: id,
        result: 'succeeded',
        afterJson: user as any,
      });
      return res.status(200).json(user);
    }

    if (req.method === 'PATCH') {
      const operations = Array.isArray(req.body?.Operations)
        ? req.body.Operations
        : [];
      const user = await components.scimService.patchUser(
        context,
        id,
        operations,
      );
      await recordScimWriteAudit({
        auditEventRepository: components.auditEventRepository,
        req,
        context,
        resourceType: 'scim_user',
        resourceId: id,
        result: 'succeeded',
        afterJson: user as any,
      });
      return res.status(200).json(user);
    }

    await components.scimService.deleteUser(context, id);
    await recordScimWriteAudit({
      auditEventRepository: components.auditEventRepository,
      req,
      context,
      resourceType: 'scim_user',
      resourceId: id,
      result: 'succeeded',
      payloadJson: {
        operation: 'delete',
      },
    });
    return res.status(204).end();
  } catch (error: any) {
    return scimError(
      res,
      /not found/i.test(error?.message || '')
        ? 404
        : /token/i.test(error?.message || '')
          ? 401
          : 400,
      error?.message || 'SCIM request failed',
    );
  }
}
