jest.mock('@server/config', () => ({
  getConfig: () => ({ userUUID: 'config-user' }),
}));

import { LearningResolver } from '../learningResolver';

describe('LearningResolver', () => {
  const originalBindingMode = process.env.WREN_AUTHORIZATION_BINDING_MODE;

  afterEach(() => {
    if (originalBindingMode === undefined) {
      delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    } else {
      process.env.WREN_AUTHORIZATION_BINDING_MODE = originalBindingMode;
    }
  });

  const createAuthorizationActor = () => ({
    principalType: 'user',
    principalId: 'user-1',
    workspaceId: 'workspace-1',
    workspaceMemberId: 'member-1',
    workspaceRoleKeys: ['owner'],
    permissionScopes: ['workspace:*'],
    isPlatformAdmin: false,
    platformRoleKeys: [],
  });

  const createContext = (overrides: Record<string, any> = {}) =>
    ({
      runtimeScope: {
        userId: 'runtime-user',
        workspace: {
          id: 'workspace-1',
        },
      },
      authorizationActor: createAuthorizationActor(),
      requestActor: {
        userId: 'request-user',
        workspaceId: 'workspace-1',
      },
      auditEventRepository: {
        createOne: jest.fn(),
      },
      learningRepository: {
        findAllBy: jest.fn().mockResolvedValue([]),
        createOne: jest.fn(),
        updateOne: jest.fn(),
      },
      ...overrides,
    }) as any;

  it('scopes learning record lookup to the active runtime user', async () => {
    const resolver = new LearningResolver();
    const createOne = jest.fn();
    const ctx = createContext({
      auditEventRepository: { createOne },
      learningRepository: {
        findAllBy: jest.fn().mockResolvedValue([{ paths: ['intro'] }]),
      },
    });

    const result = await resolver.getLearningRecord(null, null, ctx);

    expect(ctx.learningRepository.findAllBy).toHaveBeenCalledWith({
      userId: 'runtime-user',
    });
    expect(createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'workspace.read',
        resourceType: 'workspace',
        resourceId: 'workspace-1',
        result: 'allowed',
        payloadJson: {
          operation: 'get_learning_record',
        },
      }),
    );
    expect(result).toEqual({ paths: ['intro'] });
  });

  it('falls back to configured user id when runtime scope is unavailable', async () => {
    const resolver = new LearningResolver();
    const ctx = createContext({
      runtimeScope: null,
      authorizationActor: createAuthorizationActor(),
      requestActor: {
        userId: null,
        workspaceId: 'workspace-1',
      },
      learningRepository: {
        findAllBy: jest.fn().mockResolvedValue([]),
      },
    });

    await resolver.getLearningRecord(null, null, ctx);

    expect(ctx.learningRepository.findAllBy).toHaveBeenCalledWith({
      userId: 'config-user',
    });
  });

  it('writes learning records under the active runtime user', async () => {
    const resolver = new LearningResolver();
    const createOne = jest.fn();
    const ctx = createContext({
      auditEventRepository: { createOne },
      learningRepository: {
        findAllBy: jest.fn().mockResolvedValue([]),
        createOne: jest.fn().mockResolvedValue({ id: 1, paths: ['intro'] }),
      },
    });

    await resolver.saveLearningRecord(null, { data: { path: 'intro' } }, ctx);

    expect(ctx.learningRepository.findAllBy).toHaveBeenCalledWith({
      userId: 'runtime-user',
    });
    expect(ctx.learningRepository.createOne).toHaveBeenCalledWith({
      userId: 'runtime-user',
      paths: ['intro'],
    });
    expect(createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'workspace.read',
        resourceType: 'workspace',
        resourceId: 'workspace-1',
        result: 'allowed',
        payloadJson: {
          operation: 'save_learning_record',
        },
      }),
    );
  });

  it('rejects learning record reads in binding-only mode without granted actions', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
    const resolver = new LearningResolver();
    const findAllBy = jest.fn();

    await expect(
      resolver.getLearningRecord(null, null, {
        runtimeScope: {
          userId: 'runtime-user',
          workspace: {
            id: 'workspace-1',
          },
        },
        authorizationActor: {
          ...createAuthorizationActor(),
          grantedActions: [],
          workspaceRoleSource: 'legacy',
          platformRoleSource: 'legacy',
        },
        requestActor: {
          userId: 'request-user',
          workspaceId: 'workspace-1',
        },
        auditEventRepository: { createOne: jest.fn() },
        learningRepository: {
          findAllBy,
        },
      } as any),
    ).rejects.toThrow('Workspace read permission required');

    expect(findAllBy).not.toHaveBeenCalled();
  });

  it('rejects saving learning records in binding-only mode without granted actions', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
    const resolver = new LearningResolver();
    const createOne = jest.fn();

    await expect(
      resolver.saveLearningRecord(
        null,
        { data: { path: 'intro' } },
        {
          runtimeScope: {
            userId: 'runtime-user',
            workspace: {
              id: 'workspace-1',
            },
          },
          authorizationActor: {
            ...createAuthorizationActor(),
            grantedActions: [],
            workspaceRoleSource: 'legacy',
            platformRoleSource: 'legacy',
          },
          requestActor: {
            userId: 'request-user',
            workspaceId: 'workspace-1',
          },
          auditEventRepository: { createOne: jest.fn() },
          learningRepository: {
            findAllBy: jest.fn().mockResolvedValue([]),
            createOne,
          },
        } as any,
      ),
    ).rejects.toThrow('Workspace read permission required');

    expect(createOne).not.toHaveBeenCalled();
  });
});

export {};
