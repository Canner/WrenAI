import { getSessionTokenFromRequest, resolveRequestActor } from './actorClaims';

describe('actorClaims helpers', () => {
  it('prefers bearer token over session header and cookies', () => {
    const token = getSessionTokenFromRequest({
      headers: {
        authorization: 'Bearer bearer-token',
        'x-wren-session-token': 'header-token',
        cookie: 'wren_session=cookie-token',
      },
    } as any);

    expect(token).toBe('bearer-token');
  });

  it('falls back to automation service for bearer tokens when session is invalid', async () => {
    const authService = {
      validateSession: jest.fn().mockResolvedValue(null),
    };
    const automationService = {
      validateApiToken: jest.fn().mockResolvedValue({
        workspaceId: 'workspace-1',
        serviceAccount: { id: 'service-account-1' },
        token: { id: 'token-1' },
        authorizationActor: {
          principalType: 'service_account',
          principalId: 'service-account-1',
          workspaceId: 'workspace-1',
          workspaceRoleKeys: ['admin'],
          permissionScopes: ['workspace:*'],
          platformRoleKeys: [],
          isPlatformAdmin: false,
        },
      }),
    };

    const actor = await resolveRequestActor({
      req: {
        headers: {
          authorization: 'Bearer api-token',
        },
      } as any,
      authService: authService as any,
      automationService: automationService as any,
      workspaceId: 'workspace-1',
    });

    expect(authService.validateSession).toHaveBeenCalledWith(
      'api-token',
      'workspace-1',
    );
    expect(automationService.validateApiToken).toHaveBeenCalledWith(
      'api-token',
      'workspace-1',
    );
    expect(actor).toEqual(
      expect.objectContaining({
        principalType: 'service_account',
        serviceAccountId: 'service-account-1',
        apiTokenId: 'token-1',
        workspaceId: 'workspace-1',
      }),
    );
  });

  it('returns validated user session actor when session is valid', async () => {
    const validatedSession = {
      actorClaims: {
        workspaceId: 'workspace-1',
        workspaceMemberId: 'member-1',
        roleKeys: ['owner'],
        permissionScopes: ['workspace:*'],
        isPlatformAdmin: true,
        platformRoleKeys: ['platform_admin'],
      },
      user: { id: 'user-1' },
      workspace: { id: 'workspace-1' },
      membership: { id: 'member-1' },
      session: { id: 'session-1' },
    };
    const authService = {
      validateSession: jest.fn().mockResolvedValue(validatedSession),
    };

    const actor = await resolveRequestActor({
      req: {
        headers: {
          cookie: 'wren_session=session-token',
        },
      } as any,
      authService: authService as any,
      workspaceId: 'workspace-1',
    });

    expect(actor).toEqual(
      expect.objectContaining({
        sessionToken: 'session-token',
        userId: 'user-1',
        principalType: 'user',
        workspaceId: 'workspace-1',
        isPlatformAdmin: true,
        sessionId: 'session-1',
        authorizationActor: expect.objectContaining({
          principalType: 'user',
          principalId: 'user-1',
          workspaceId: 'workspace-1',
        }),
      }),
    );
  });
});
