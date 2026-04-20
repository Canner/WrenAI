import {
  canShowPlatformManagement,
  resolvePlatformActionFromAuthSession,
  resolvePlatformConsoleCapabilities,
  resolvePlatformManagementFromAuthSession,
} from './settingsPageCapabilities';
import type { AuthSessionPayload } from '@/hooks/useAuthSession';

describe('settingsPageCapabilities', () => {
  it('returns true when any platform role or session admin flags are present', () => {
    expect(
      canShowPlatformManagement({
        platformRoleKeys: ['platform_admin'],
      }),
    ).toBe(true);
    expect(
      canShowPlatformManagement({
        platformRoleKeys: ['platform_workspace_admin'],
      }),
    ).toBe(true);
    expect(
      canShowPlatformManagement({
        sessionIsPlatformAdmin: true,
      }),
    ).toBe(true);
  });

  it('returns false when neither actor roles nor session flags grant access', () => {
    expect(
      canShowPlatformManagement({
        platformRoleKeys: [],
      }),
    ).toBe(false);
    expect(canShowPlatformManagement({})).toBe(false);
  });

  it('derives settings platform visibility from auth session payloads', () => {
    expect(
      resolvePlatformManagementFromAuthSession({
        authenticated: true,
        authorization: {
          actor: {
            principalType: 'user',
            principalId: 'user-1',
            platformRoleKeys: ['platform_admin'],
          },
          actions: {},
        },
      }),
    ).toBe(true);

    expect(
      resolvePlatformManagementFromAuthSession({
        authenticated: true,
        authorization: {
          actor: {
            principalType: 'user',
            principalId: 'user-2',
            platformRoleKeys: ['platform_iam_admin'],
          },
          actions: {},
        },
      }),
    ).toBe(true);
  });

  it('treats platform admin as having all platform capabilities', () => {
    expect(
      resolvePlatformActionFromAuthSession(
        {
          authenticated: true,
          isPlatformAdmin: true,
        },
        'platform.role.delete',
      ),
    ).toBe(true);
  });

  it('derives fine-grained platform actions from granted actions', () => {
    const authSession: AuthSessionPayload = {
      authenticated: true,
      authorization: {
        actor: {
          principalType: 'user',
          principalId: 'user-2',
          platformRoleKeys: ['platform_workspace_admin'],
          grantedActions: [
            'platform.workspace.read',
            'workspace.create',
            'platform.workspace.member.manage',
          ],
        },
        actions: {},
      },
    };

    expect(
      resolvePlatformActionFromAuthSession(
        authSession,
        'platform.workspace.read',
      ),
    ).toBe(true);
    expect(
      resolvePlatformActionFromAuthSession(authSession, 'platform.user.read'),
    ).toBe(false);
    expect(resolvePlatformConsoleCapabilities(authSession)).toEqual(
      expect.objectContaining({
        canReadWorkspaces: true,
        canCreateWorkspace: true,
        canManageWorkspaceMembers: true,
        canReadUsers: false,
        canReadRoles: false,
      }),
    );
  });

  it('treats platform system task manage as a separate platform capability', () => {
    const authSession: AuthSessionPayload = {
      authenticated: true,
      authorization: {
        actor: {
          principalType: 'user',
          principalId: 'user-3',
          platformRoleKeys: ['platform_workspace_admin'],
          grantedActions: [
            'platform.workspace.read',
            'platform.system_task.read',
            'platform.system_task.manage',
          ],
        },
        actions: {},
      },
    };

    expect(
      resolvePlatformActionFromAuthSession(
        authSession,
        'platform.system_task.manage',
      ),
    ).toBe(true);
    expect(resolvePlatformConsoleCapabilities(authSession)).toEqual(
      expect.objectContaining({
        canReadSystemTasks: true,
        canManageSystemTasks: true,
      }),
    );
  });
});
