export {};

const originalBindingMode = process.env.WREN_AUTHORIZATION_BINDING_MODE;

const mockResolveRequestScopeForSecretReencrypt = jest.fn();
const mockRespondWithSimple = jest.fn();
const mockReencryptSecrets = jest.fn();
const mockCreateAuditEvent = jest.fn();
const mockHandleApiError = jest.fn(
  async ({
    error,
    res,
  }: {
    error: Error & { statusCode?: number };
    res: any;
  }) => {
    res.statusCode = error.statusCode || 500;
    res.body = { error: error.message };
  },
);

class MockApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

jest.mock('@/common', () => ({
  components: {
    runtimeScopeResolver: {
      resolveRequestScope: mockResolveRequestScopeForSecretReencrypt,
    },
    secretRepository: { findAll: jest.fn() },
    secretService: {
      decryptPayload: jest.fn(),
      encryptPayload: jest.fn(),
    },
    auditEventRepository: {
      createOne: mockCreateAuditEvent,
    },
  },
}));

jest.mock('@server/services/secretReencrypt', () => ({
  reencryptSecrets: (...args: any[]) => mockReencryptSecrets(...args),
}));

jest.mock('@/server/utils/apiUtils', () => ({
  ApiError: MockApiError,
  respondWithSimple: mockRespondWithSimple,
  handleApiError: mockHandleApiError,
}));

jest.mock('@server/utils', () => ({
  getLogger: () => ({
    level: 'debug',
    error: jest.fn(),
  }),
}));

describe('pages/api/v1/secrets/reencrypt', () => {
  const buildRuntimeScope = (overrides: Partial<any> = {}) => ({
    project: { id: 5 },
    workspace: { id: 'workspace-1', kind: 'regular' },
    knowledgeBase: { id: 'kb-1', kind: 'regular' },
    userId: 'user-1',
    actorClaims: {
      workspaceId: 'workspace-1',
      workspaceMemberId: 'member-1',
      roleKeys: ['owner'],
      permissionScopes: ['workspace:*'],
      grantedActions: ['secret.reencrypt'],
      workspaceRoleSource: 'role_binding',
      platformRoleSource: 'legacy',
    },
    ...overrides,
  });

  const createReq = (overrides: Partial<any> = {}) =>
    ({
      method: 'POST',
      body: {},
      query: {},
      headers: {},
      ...overrides,
    }) as any;

  const createRes = () => ({ statusCode: 200, body: null }) as any;

  beforeEach(() => {
    delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    jest.clearAllMocks();
  });

  afterAll(() => {
    if (originalBindingMode === undefined) {
      delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    } else {
      process.env.WREN_AUTHORIZATION_BINDING_MODE = originalBindingMode;
    }
  });

  it('runs workspace-scoped dry-run re-encrypt summary', async () => {
    const handler = (await import('../v1/secrets/reencrypt')).default;
    const req = createReq({
      body: {
        targetKeyVersion: 2,
        sourceKeyVersion: 1,
        scopeType: 'connector',
      },
    });
    const res = createRes();

    mockResolveRequestScopeForSecretReencrypt.mockResolvedValue(
      buildRuntimeScope(),
    );
    mockReencryptSecrets.mockResolvedValue({
      dryRun: true,
      scanned: 4,
      eligible: 2,
      updated: 0,
      skipped: 2,
      targetKeyVersion: 2,
      filters: {
        workspaceId: 'workspace-1',
        scopeType: 'connector',
        sourceKeyVersion: 1,
      },
      records: [
        {
          id: 'secret-1',
          workspaceId: 'workspace-1',
          scopeType: 'connector',
          scopeId: 'connector-1',
          fromKeyVersion: 1,
          toKeyVersion: 2,
        },
      ],
    });

    await handler(req, res);

    expect(mockReencryptSecrets).toHaveBeenCalledWith(
      expect.objectContaining({
        secretRepository: expect.any(Object),
        sourceSecretService: expect.any(Object),
        targetSecretService: expect.any(Object),
      }),
      {
        workspaceId: 'workspace-1',
        scopeType: 'connector',
        sourceKeyVersion: 1,
        targetKeyVersion: 2,
        execute: false,
      },
    );
    expect(mockRespondWithSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 200,
        responsePayload: expect.objectContaining({
          dryRun: true,
          eligible: 2,
        }),
      }),
    );
  });

  it('supports execute mode', async () => {
    const handler = (await import('../v1/secrets/reencrypt')).default;
    const req = createReq({
      body: {
        targetKeyVersion: 3,
        execute: true,
      },
    });
    const res = createRes();

    mockResolveRequestScopeForSecretReencrypt.mockResolvedValue(
      buildRuntimeScope(),
    );
    mockReencryptSecrets.mockResolvedValue({
      dryRun: false,
      scanned: 2,
      eligible: 2,
      updated: 2,
      skipped: 0,
      targetKeyVersion: 3,
      filters: {
        workspaceId: 'workspace-1',
      },
      records: [],
    });

    await handler(req, res);

    expect(mockReencryptSecrets).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        workspaceId: 'workspace-1',
        targetKeyVersion: 3,
        execute: true,
      }),
    );
    expect(mockHandleApiError).not.toHaveBeenCalled();
  });

  it('returns 403 for secret reencrypt in binding-only mode without granted actions', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
    const handler = (await import('../v1/secrets/reencrypt')).default;
    const req = createReq({
      body: {
        targetKeyVersion: 2,
      },
    });
    const res = createRes();

    mockResolveRequestScopeForSecretReencrypt.mockResolvedValue(
      buildRuntimeScope({
        actorClaims: {
          workspaceId: 'workspace-1',
          workspaceMemberId: 'member-1',
          roleKeys: ['owner'],
          permissionScopes: ['workspace:*'],
          grantedActions: [],
          workspaceRoleSource: 'legacy',
          platformRoleSource: 'legacy',
        },
      }),
    );

    await handler(req, res);

    expect(mockReencryptSecrets).not.toHaveBeenCalled();
    expect(mockHandleApiError).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      error: expect.stringMatching(/permission required/i),
    });
  });

  it('rejects invalid payload', async () => {
    const handler = (await import('../v1/secrets/reencrypt')).default;
    const req = createReq({
      body: {
        targetKeyVersion: 0,
      },
    });
    const res = createRes();

    mockResolveRequestScopeForSecretReencrypt.mockResolvedValue(
      buildRuntimeScope(),
    );

    await handler(req, res);

    expect(mockReencryptSecrets).not.toHaveBeenCalled();
    expect(mockHandleApiError).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: 'targetKeyVersion must be a positive integer',
    });
  });
});
