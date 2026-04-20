import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import {
  buildPlatformUserRecord,
  listPlatformRoleAssignments,
  requirePlatformActionContext,
  sortWorkspacesByName,
} from '../platformApiUtils';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (!['GET', 'POST'].includes(String(req.method))) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (req.method === 'POST') {
      await requirePlatformActionContext({
        req,
        action: 'platform.user.create',
      });
      const email =
        typeof req.body?.email === 'string' ? req.body.email.trim() : '';
      const password =
        typeof req.body?.password === 'string' ? req.body.password.trim() : '';
      const displayName =
        typeof req.body?.displayName === 'string'
          ? req.body.displayName.trim()
          : '';

      if (!email || !password || !displayName) {
        return res.status(400).json({
          error: 'email, password, and displayName are required',
        });
      }

      const authResult = await components.authService.registerLocalUser({
        email,
        password,
        displayName,
      });

      await components.authService.logout(authResult.sessionToken);

      return res.status(201).json({
        user: {
          id: authResult.user.id,
          email: authResult.user.email,
          displayName: authResult.user.displayName || null,
          status: authResult.user.status || 'active',
          isPlatformAdmin: Boolean(authResult.user.isPlatformAdmin),
          defaultWorkspaceId: authResult.user.defaultWorkspaceId || null,
        },
      });
    }

    await requirePlatformActionContext({
      req,
      action: 'platform.user.read',
    });

    const [users, workspaces, memberships, platformRoleData] = await Promise.all([
      components.userRepository.findAll({
        order: 'display_name asc, email asc',
      }),
      components.workspaceRepository.findAllBy(
        { status: 'active' },
        { order: 'name asc' },
      ),
      components.workspaceMemberRepository.findAll({
        order: 'workspace_id asc, created_at asc',
      }),
      listPlatformRoleAssignments(),
    ]);

    const workspaceById = new Map(
      workspaces.map((workspace) => [workspace.id, workspace]),
    );
    const membershipsByUserId = memberships.reduce<Map<string, any[]>>(
      (acc, membership) => {
        const entries = acc.get(membership.userId) || [];
        entries.push(membership);
        acc.set(membership.userId, entries);
        return acc;
      },
      new Map(),
    );

    return res.status(200).json({
      users: users.map((user) =>
        buildPlatformUserRecord({
          user,
          memberships: membershipsByUserId.get(user.id) || [],
          workspaceById,
          platformRoles: platformRoleData.platformRolesByUserId.get(user.id) || [],
          platformAdminFallbackRole: platformRoleData.platformAdminRole,
        }),
      ),
      platformRoleCatalog: platformRoleData.platformRoleCatalog,
      workspaces: sortWorkspacesByName(workspaces).map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug || null,
        kind: workspace.kind || 'regular',
      })),
      stats: {
        userCount: users.length,
        platformAdminCount: users.filter((user) =>
          Boolean(user.isPlatformAdmin),
        ).length,
        workspaceCount: workspaces.length,
      },
    });
  } catch (error: any) {
    return res.status(error?.statusCode || 400).json({
      error: error?.message || 'Failed to load platform users',
    });
  }
}
