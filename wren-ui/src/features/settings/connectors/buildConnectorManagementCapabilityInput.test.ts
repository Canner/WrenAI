import buildConnectorManagementCapabilityInput from './buildConnectorManagementCapabilityInput';

describe('buildConnectorManagementCapabilityInput', () => {
  it('maps auth session state into connector capability input', () => {
    expect(
      buildConnectorManagementCapabilityInput({
        data: {
          workspace: { kind: 'regular' },
          authorization: {
            actions: { 'connector.read': true },
            actor: {
              platformRoleKeys: ['platform_admin'],
              isPlatformAdmin: true,
            },
          },
          isPlatformAdmin: false,
        },
      } as any),
    ).toEqual({
      workspaceKind: 'regular',
      authorizationActions: { 'connector.read': true },
      platformRoleKeys: ['platform_admin'],
      actorIsPlatformAdmin: true,
      sessionIsPlatformAdmin: false,
    });
  });
});
