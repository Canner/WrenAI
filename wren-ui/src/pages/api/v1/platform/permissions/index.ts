import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import {
  createCustomPlatformRole,
  listPlatformRoleCatalog,
} from '@server/authz';
import {
  createHttpError,
  getString,
  requirePlatformActionContext,
} from '../platformApiUtils';

const getPlatformRoleCatalogDeps = () => ({
  roleRepository: components.roleRepository,
  permissionRepository: components.permissionRepository,
  rolePermissionRepository: components.rolePermissionRepository,
  principalRoleBindingRepository: components.principalRoleBindingRepository,
});

const getPermissionNames = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
};

const resolveApiError = (
  error: any,
  fallbackMessage: string,
): { statusCode: number; message: string } => {
  const message = error?.message || fallbackMessage;
  if (error?.statusCode) {
    return { statusCode: error.statusCode, message };
  }
  if (/not found/i.test(message)) {
    return { statusCode: 404, message };
  }
  if (/already exists/i.test(message)) {
    return { statusCode: 409, message };
  }
  return { statusCode: 400, message };
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!['GET', 'POST'].includes(String(req.method))) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const deps = getPlatformRoleCatalogDeps();

    if (req.method === 'POST') {
      const context = await requirePlatformActionContext({
        req,
        action: 'platform.role.create',
      });
      const name = getString(req.body?.name);
      const displayName = getString(req.body?.displayName) || name;
      const description = getString(req.body?.description) || null;
      const permissionNames = getPermissionNames(req.body?.permissionNames);
      const isActive =
        typeof req.body?.isActive === 'boolean' ? req.body.isActive : true;

      if (!name) {
        throw createHttpError(400, 'name is required');
      }
      if (!displayName) {
        throw createHttpError(400, 'displayName is required');
      }

      const createdRole = await createCustomPlatformRole({
        ...deps,
        name,
        displayName,
        description,
        isActive,
        permissionNames,
        createdBy: context.actor.principalId,
      });

      const catalog = await listPlatformRoleCatalog(deps);
      const role = catalog.roles.find((item) => item.id === createdRole.id) || null;

      return res.status(201).json({
        role,
      });
    }

    const context = await requirePlatformActionContext({
      req,
      action: 'platform.role.read',
    });
    const catalog = await listPlatformRoleCatalog(deps);
    return res.status(200).json({
      ...catalog,
      actor: {
        principalId: context.actor.principalId,
        platformRoleKeys: context.actor.platformRoleKeys,
        isPlatformAdmin: context.actor.isPlatformAdmin,
      },
    });
  } catch (error: any) {
    const { statusCode, message } = resolveApiError(
      error,
      'Failed to load platform permissions',
    );
    return res.status(statusCode).json({ error: message });
  }
}
