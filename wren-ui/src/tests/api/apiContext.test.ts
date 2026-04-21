export {};

const mockResolveRequestScope = jest.fn();
const mockResolveRequestActor = jest.fn();

jest.mock('@/common', () => ({
  components: {
    runtimeScopeResolver: {
      resolveRequestScope: mockResolveRequestScope,
    },
    authService: {},
    automationService: {},
  },
  serverConfig: {
    env: 'test',
  },
}));

jest.mock('@server/context/actorClaims', () => ({
  resolveRequestActor: (...args: any[]) => mockResolveRequestActor(...args),
}));

describe('buildApiContextFromRequest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows runtime-scope bootstrap requests to proceed without an explicit selector', async () => {
    const { RuntimeScopeResolutionError } =
      await import('@server/context/runtimeScope');

    mockResolveRequestScope.mockRejectedValue(
      new RuntimeScopeResolutionError(
        'Runtime scope selector is required for this request',
      ),
    );
    mockResolveRequestActor.mockResolvedValue({
      sessionToken: null,
      actorClaims: null,
      userId: 'user-1',
      workspaceId: 'ws-1',
      authorizationActor: null,
      sessionId: null,
    });

    const { buildApiContextFromRequest } =
      await import('@/server/api/apiContext');

    const ctx = await buildApiContextFromRequest({
      req: {
        headers: {},
      } as any,
      allowMissingRuntimeScope: true,
    });

    expect(mockResolveRequestScope).toHaveBeenCalled();
    expect(mockResolveRequestActor).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: undefined,
      }),
    );
    expect(ctx.runtimeScope).toBeNull();
    expect(ctx.requestActor).toEqual(
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: 'ws-1',
      }),
    );
  });

  it('still throws when missing runtime scope is not explicitly allowed', async () => {
    const { RuntimeScopeResolutionError } =
      await import('@server/context/runtimeScope');
    const error = new RuntimeScopeResolutionError(
      'Runtime scope selector is required for this request',
    );
    mockResolveRequestScope.mockRejectedValue(error);

    const { buildApiContextFromRequest } =
      await import('@/server/api/apiContext');

    await expect(
      buildApiContextFromRequest({
        req: {
          headers: {},
        } as any,
      }),
    ).rejects.toBe(error);
  });
});
