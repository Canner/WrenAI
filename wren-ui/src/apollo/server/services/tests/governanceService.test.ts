import { GovernanceService } from '../governanceService';

describe('GovernanceService', () => {
  const originalBindingMode = process.env.WREN_AUTHORIZATION_BINDING_MODE;

  beforeEach(() => {
    delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
  });

  afterAll(() => {
    if (originalBindingMode === undefined) {
      delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    } else {
      process.env.WREN_AUTHORIZATION_BINDING_MODE = originalBindingMode;
    }
  });

  const buildValidatedSession = (
    workspaceId = 'workspace-1',
    userId = 'user-1',
  ) =>
    ({
      workspace: { id: workspaceId, kind: 'regular' },
      membership: { id: `member-${userId}`, roleKey: 'owner' },
      user: { id: userId, isPlatformAdmin: false, status: 'active' },
      session: { id: `session-${userId}` },
      actorClaims: {
        workspaceId,
        workspaceMemberId: `member-${userId}`,
        roleKeys: ['owner'],
        permissionScopes: [`workspace:${workspaceId}`],
      },
    }) as any;

  const buildService = ({
    workspace,
    itemWorkspaceId = 'workspace-1',
    principalRoleBindings = [],
  }: {
    workspace?: { id: string; kind?: string | null } | null;
    itemWorkspaceId?: string;
    principalRoleBindings?: Array<{ roleName: string }>;
  }) => {
    const accessReviewRepository = {
      findAllBy: jest.fn(),
      findOneBy: jest.fn().mockResolvedValue({
        id: 'review-1',
        workspaceId: 'workspace-1',
      }),
      createOne: jest.fn(),
      updateOne: jest.fn(),
    };
    const accessReviewItemRepository = {
      findAllBy: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn().mockResolvedValue({
        id: 'item-1',
        accessReviewId: 'review-1',
        workspaceId: itemWorkspaceId,
        status: 'pending',
      }),
      updateOne: jest.fn(),
    };
    const workspaceMemberRepository = {
      findAllBy: jest.fn().mockResolvedValue([]),
      findOneBy: jest.fn(),
    };
    const userRepository = {
      findOneBy: jest.fn(),
    };
    const authIdentityRepository = {
      findAllBy: jest.fn(),
    };
    const authSessionRepository = {
      updateOne: jest.fn(),
    };
    const workspaceService = {
      getWorkspaceById: jest.fn().mockResolvedValue(workspace ?? null),
      updateMember: jest.fn(),
      getMembership: jest.fn(),
    };
    const authService = {
      issueSessionForIdentity: jest.fn(),
    };
    const principalRoleBindingRepository = {
      findResolvedRoleBindings: jest
        .fn()
        .mockResolvedValue(principalRoleBindings),
    };

    const service = new GovernanceService(
      accessReviewRepository as any,
      accessReviewItemRepository as any,
      workspaceMemberRepository as any,
      userRepository as any,
      authIdentityRepository as any,
      authSessionRepository as any,
      workspaceService as any,
      authService as any,
      undefined,
      undefined,
      undefined,
      undefined,
      principalRoleBindingRepository as any,
    );

    return {
      service,
      accessReviewRepository,
      accessReviewItemRepository,
      workspaceMemberRepository,
      userRepository,
      authIdentityRepository,
      authService,
      principalRoleBindingRepository,
      workspaceService,
    };
  };

  it('rejects creating access reviews in the default workspace', async () => {
    const { service, accessReviewRepository } = buildService({
      workspace: { id: 'workspace-default', kind: 'default' },
    });

    await expect(
      service.createAccessReview({
        validatedSession: buildValidatedSession('workspace-default'),
        title: 'Quarterly review',
      }),
    ).rejects.toThrow(
      'Default workspace does not support this governance action',
    );

    expect(accessReviewRepository.createOne).not.toHaveBeenCalled();
  });

  it('rejects access review items that do not belong to the current workspace', async () => {
    const { service, accessReviewItemRepository } = buildService({
      workspace: { id: 'workspace-1', kind: 'regular' },
      itemWorkspaceId: 'workspace-2',
    });

    await expect(
      service.reviewAccessReviewItem({
        validatedSession: buildValidatedSession('workspace-1'),
        accessReviewId: 'review-1',
        itemId: 'item-1',
        decision: 'keep',
      }),
    ).rejects.toThrow('Access review item not found');

    expect(accessReviewItemRepository.updateOne).not.toHaveBeenCalled();
  });

  it('allows impersonation when platform_admin comes from role bindings', async () => {
    const {
      service,
      userRepository,
      authIdentityRepository,
      authService,
      principalRoleBindingRepository,
    } = buildService({
      workspace: { id: 'workspace-1', kind: 'regular' },
      principalRoleBindings: [{ roleName: 'platform_admin' }],
    });

    userRepository.findOneBy
      .mockResolvedValueOnce({
        id: 'admin-1',
        isPlatformAdmin: false,
        status: 'active',
      })
      .mockResolvedValueOnce({
        id: 'user-2',
        status: 'active',
      });
    authIdentityRepository.findAllBy.mockResolvedValue([
      { id: 'identity-1', providerType: 'local' },
    ]);
    authService.issueSessionForIdentity.mockResolvedValue({
      sessionToken: 'token-1',
    });

    await service.startImpersonation({
      validatedSession: buildValidatedSession('workspace-1', 'admin-1'),
      targetUserId: 'user-2',
      workspaceId: 'workspace-1',
      reason: 'support',
    });

    expect(
      principalRoleBindingRepository.findResolvedRoleBindings,
    ).toHaveBeenCalledWith({
      principalType: 'user',
      principalId: 'admin-1',
      scopeType: 'platform',
      scopeId: '',
    });
    expect(authService.issueSessionForIdentity).toHaveBeenCalledWith({
      userId: 'user-2',
      authIdentityId: 'identity-1',
      workspaceId: 'workspace-1',
      impersonatorUserId: 'admin-1',
      impersonationReason: 'support',
    });
  });

  it('rejects impersonation when neither role binding nor legacy flag grants platform admin', async () => {
    const { service, userRepository, principalRoleBindingRepository } =
      buildService({
        workspace: { id: 'workspace-1', kind: 'regular' },
        principalRoleBindings: [],
      });

    userRepository.findOneBy
      .mockResolvedValueOnce({
        id: 'admin-1',
        isPlatformAdmin: false,
        status: 'active',
      })
      .mockResolvedValueOnce({
        id: 'user-2',
        status: 'active',
      });

    await expect(
      service.startImpersonation({
        validatedSession: buildValidatedSession('workspace-1', 'admin-1'),
        targetUserId: 'user-2',
        workspaceId: 'workspace-1',
        reason: 'support',
      }),
    ).rejects.toThrow('Platform admin permission required');

    expect(
      principalRoleBindingRepository.findResolvedRoleBindings,
    ).toHaveBeenCalledWith({
      principalType: 'user',
      principalId: 'admin-1',
      scopeType: 'platform',
      scopeId: '',
    });
  });

  it('binding-only mode ignores legacy platform admin flags during impersonation checks', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';

    const { service, userRepository } = buildService({
      workspace: { id: 'workspace-1', kind: 'regular' },
      principalRoleBindings: [],
    });
    userRepository.findOneBy
      .mockResolvedValueOnce({
        id: 'admin-1',
        isPlatformAdmin: true,
        status: 'active',
      })
      .mockResolvedValueOnce({
        id: 'user-2',
        status: 'active',
      });

    await expect(
      service.startImpersonation({
        validatedSession: buildValidatedSession('workspace-1', 'admin-1'),
        targetUserId: 'user-2',
        workspaceId: 'workspace-1',
        reason: 'support',
      }),
    ).rejects.toThrow('Platform admin permission required');
  });
});
