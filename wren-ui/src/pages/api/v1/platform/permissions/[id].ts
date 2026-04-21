import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import {
  deletePlatformRole,
  listPlatformRoleCatalog,
  updatePlatformRole,
} from '@server/authz';
import {
  createHttpError,
  getQueryString,
  getString,
  requirePlatformActionContext,
} from '@server/api/platform/platformApiUtils';

const getPlatformRoleCatalogDeps = () => ({
  roleRepository: components.roleRepository,
  permissionRepository: components.permissionRepository,
  rolePermissionRepository: components.rolePermissionRepository,
  principalRoleBindingRepository: components.principalRoleBindingRepository,
});

const getPermissionNames = (value: unknown) => {
  if (!Array.isArray(value)) {
    return undefined;
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
  if (!['PATCH', 'DELETE'].includes(String(req.method))) {
    res.setHeader('Allow', 'PATCH, DELETE');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const roleId = getString(getQueryString(req.query.id));
    if (!roleId) {
      throw createHttpError(400, 'Role id is required');
    }

    const deps = getPlatformRoleCatalogDeps();

    if (req.method === 'DELETE') {
      await requirePlatformActionContext({
        req,
        action: 'platform.role.delete',
      });
      const deletedRole = await deletePlatformRole({
        roleId,
        roleRepository: deps.roleRepository,
      });
      return res.status(200).json({
        roleId: deletedRole.id,
      });
    }

    await requirePlatformActionContext({
      req,
      action: 'platform.role.update',
    });

    const permissionNames = getPermissionNames(req.body?.permissionNames);
    await updatePlatformRole({
      roleId,
      name: Object.prototype.hasOwnProperty.call(req.body || {}, 'name')
        ? getString(req.body?.name)
        : undefined,
      displayName: Object.prototype.hasOwnProperty.call(
        req.body || {},
        'displayName',
      )
        ? getString(req.body?.displayName)
        : undefined,
      description: Object.prototype.hasOwnProperty.call(
        req.body || {},
        'description',
      )
        ? getString(req.body?.description) || null
        : undefined,
      isActive:
        typeof req.body?.isActive === 'boolean' ? req.body.isActive : undefined,
      permissionNames,
      roleRepository: deps.roleRepository,
      permissionRepository: deps.permissionRepository,
      rolePermissionRepository: deps.rolePermissionRepository,
    });

    const catalog = await listPlatformRoleCatalog(deps);
    const role = catalog.roles.find((item) => item.id === roleId) || null;
    return res.status(200).json({ role });
  } catch (error: any) {
    const { statusCode, message } = resolveApiError(
      error,
      'Failed to update platform role',
    );
    return res.status(statusCode).json({ error: message });
  }
}
