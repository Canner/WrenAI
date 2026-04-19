import {
  canShowPlatformManagement,
  resolvePlatformManagementFromAuthSession,
} from './settingsPageCapabilities';

describe('settingsPageCapabilities', () => {
  it('returns true when platform_admin role or session admin flags are present', () => {
    expect(
      canShowPlatformManagement({
        platformRoleKeys: ['platform_admin'],
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
        platformRoleKeys: ['workspace_admin'],
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
            platformRoleKeys: ['member'],
          },
          actions: {},
        },
      }),
    ).toBe(false);
  });
});
