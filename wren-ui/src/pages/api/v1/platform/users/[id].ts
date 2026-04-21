import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { PLATFORM_ADMIN_ROLE_NAME, PLATFORM_SCOPE_ID } from '@server/authz';
import {
  buildPlatformUserRecord,
  createHttpError,
  getString,
  listPlatformRoleAssignments,
  requirePlatformActionContext,
} from '@server/api/platform/platformApiUtils';

const getPlatformRoleIds = (value: unknown) =>
  Array.isArray(value)
    ? value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
    : null;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!['GET', 'PATCH'].includes(String(req.method))) {
    res.setHeader('Allow', 'GET, PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const id = getString(req.query.id);
    if (!id) {
      throw createHttpError(400, 'User id is required');
    }

    const user = await components.userRepository.findOneBy({ id });
    if (!user) {
      throw createHttpError(404, 'User not found');
    }

    if (req.method === 'PATCH') {
      const needsRoleAssignment = Object.prototype.hasOwnProperty.call(
        req.body || {},
        'platformRoleIds',
      );
      const context = await requirePlatformActionContext({
        req,
        action: needsRoleAssignment
          ? 'platform.user.role.assign'
          : 'platform.user.update',
      });
      const patch: Record<string, any> = {};
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'displayName')) {
        const displayName = getString(req.body?.displayName);
        if (!displayName) {
          throw createHttpError(400, 'displayName is required');
        }
        patch.displayName = displayName;
      }

      const explicitPlatformRoleIds = getPlatformRoleIds(
        req.body?.platformRoleIds,
      );
      const shouldTogglePlatformAdmin =
        typeof req.body?.isPlatformAdmin === 'boolean';
      const shouldSyncPlatformRoles =
        explicitPlatformRoleIds !== null || shouldTogglePlatformAdmin;

      let nextPlatformRoleIds: string[] | null = explicitPlatformRoleIds;
      if (
        Object.prototype.hasOwnProperty.call(
          req.body || {},
          'defaultWorkspaceId',
        )
      ) {
        const workspaces = await components.workspaceRepository.findAllBy(
          { status: 'active' },
          { order: 'name asc' },
        );
        const memberships =
          await components.workspaceMemberRepository.findAllBy(
            { userId: id },
            { order: 'created_at asc' },
          );
        const defaultWorkspaceId = getString(req.body?.defaultWorkspaceId);
        if (!defaultWorkspaceId) {
          patch.defaultWorkspaceId = null;
        } else {
          const hasActiveMembership = memberships.some(
            (membership) =>
              membership.workspaceId === defaultWorkspaceId &&
              membership.status === 'active',
          );
          const workspaceExists = workspaces.some(
            (workspace) => workspace.id === defaultWorkspaceId,
          );
          if (!workspaceExists || !hasActiveMembership) {
            throw createHttpError(
              400,
              'Default workspace must be one of the user memberships',
            );
          }
          patch.defaultWorkspaceId = defaultWorkspaceId;
        }
      }

      if (shouldSyncPlatformRoles) {
        const platformRoleData = await listPlatformRoleAssignments();
        const currentPlatformRoleIds = (
          platformRoleData.platformRolesByUserId.get(id) ||
          (user.isPlatformAdmin && platformRoleData.platformAdminRole
            ? [platformRoleData.platformAdminRole]
            : [])
        ).map((role) => role.id);

        if (nextPlatformRoleIds === null) {
          nextPlatformRoleIds = Array.from(new Set(currentPlatformRoleIds));
          const platformAdminRoleId = platformRoleData.platformAdminRole?.id;
          if (!platformAdminRoleId) {
            throw createHttpError(400, 'platform_admin role is not seeded');
          }
          if (req.body.isPlatformAdmin) {
            nextPlatformRoleIds.push(platformAdminRoleId);
          } else {
            nextPlatformRoleIds = nextPlatformRoleIds.filter(
              (roleId) => roleId !== platformAdminRoleId,
            );
          }
        }

        const normalizedRoleIds = Array.from(new Set(nextPlatformRoleIds));
        const roleById = new Map(
          platformRoleData.platformRoleCatalog.map((role) => [role.id, role]),
        );
        const invalidRoleId = normalizedRoleIds.find((roleId) => {
          const role = roleById.get(roleId);
          return !role || role.isActive === false;
        });
        if (invalidRoleId) {
          throw createHttpError(400, 'Invalid platform role selection');
        }

        const hasPlatformAdminRole = normalizedRoleIds.some(
          (roleId) => roleById.get(roleId)?.name === PLATFORM_ADMIN_ROLE_NAME,
        );

        const tx = await components.roleRepository.transaction();
        try {
          await components.principalRoleBindingRepository.deleteByScope(
            {
              principalType: 'user',
              principalId: id,
              scopeType: 'platform',
              scopeId: PLATFORM_SCOPE_ID,
            },
            { tx },
          );

          for (const roleId of normalizedRoleIds) {
            await components.principalRoleBindingRepository.createOne(
              {
                id: crypto.randomUUID(),
                principalType: 'user',
                principalId: id,
                roleId,
                scopeType: 'platform',
                scopeId: PLATFORM_SCOPE_ID,
                createdBy: context.actor.principalId,
              },
              { tx },
            );
          }

          await components.userRepository.updateOne(
            id,
            {
              ...patch,
              isPlatformAdmin: hasPlatformAdminRole,
            },
            { tx },
          );
          await components.roleRepository.commit(tx);
        } catch (error) {
          await components.roleRepository.rollback(tx);
          throw error;
        }
      } else {
        if (!Object.keys(patch).length) {
          throw createHttpError(400, 'No user update payload provided');
        }
        await components.userRepository.updateOne(id, patch);
      }
    }

    if (req.method === 'GET') {
      await requirePlatformActionContext({
        req,
        action: 'platform.user.read',
      });
    }

    const [refreshedUser, workspaces, memberships, platformRoleData] =
      await Promise.all([
        components.userRepository.findOneBy({ id }),
        components.workspaceRepository.findAllBy(
          { status: 'active' },
          { order: 'name asc' },
        ),
        components.workspaceMemberRepository.findAllBy(
          { userId: id },
          { order: 'created_at asc' },
        ),
        listPlatformRoleAssignments(),
      ]);

    return res.status(200).json({
      user: buildPlatformUserRecord({
        user: refreshedUser,
        memberships,
        workspaceById: new Map(
          workspaces.map((workspace) => [workspace.id, workspace]),
        ),
        platformRoles: platformRoleData.platformRolesByUserId.get(id) || [],
        platformAdminFallbackRole: platformRoleData.platformAdminRole,
      }),
      platformRoleCatalog: platformRoleData.platformRoleCatalog,
    });
  } catch (error: any) {
    return res.status(error?.statusCode || 400).json({
      error: error?.message || 'Failed to load platform user',
    });
  }
}
