import { WorkspaceService } from '../workspaceService';

describe('WorkspaceService', () => {
  const validatedSession = {
    workspace: {
      id: 'workspace-1',
      kind: 'regular',
    },
    membership: { id: 'member-actor', roleKey: 'owner' },
    user: {
      id: 'user-1',
      email: 'owner@example.com',
    },
    session: { id: 'session-1' },
    actorClaims: {
      workspaceId: 'workspace-1',
      workspaceMemberId: 'member-actor',
      roleKeys: ['owner'],
      permissionScopes: ['workspace:workspace-1'],
    },
  } as any;

  let workspaceRepository: any;
  let workspaceMemberRepository: any;
  let userRepository: any;
  let service: WorkspaceService;

  beforeEach(() => {
    workspaceRepository = {
      findOneBy: jest.fn(),
      findAllBy: jest.fn(),
      createOne: jest.fn(),
      updateOne: jest.fn(),
      transaction: jest.fn().mockResolvedValue({ id: 'tx' }),
      commit: jest.fn(),
      rollback: jest.fn(),
    };
    workspaceMemberRepository = {
      findOneBy: jest.fn(),
      findAllBy: jest.fn(),
      createOne: jest.fn(),
      updateOne: jest.fn(),
      deleteOne: jest.fn(),
    };
    userRepository = {
      findOneBy: jest.fn(),
      updateOne: jest.fn(),
    };

    service = new WorkspaceService({
      workspaceRepository,
      workspaceMemberRepository,
      userRepository,
    });
  });

  it('syncs structured binding when membership becomes active', async () => {
    const roleRepository = {
      findByNames: jest.fn().mockResolvedValue([
        {
          id: 'role-viewer',
          name: 'workspace_viewer',
        },
      ]),
    };
    const principalRoleBindingRepository = {
      deleteByScope: jest.fn().mockResolvedValue(1),
      createOne: jest.fn().mockResolvedValue({
        id: 'binding-1',
      }),
    };
    const structuredService = new WorkspaceService({
      workspaceRepository,
      workspaceMemberRepository,
      userRepository,
      roleRepository: roleRepository as any,
      principalRoleBindingRepository: principalRoleBindingRepository as any,
    });

    userRepository.findOneBy.mockResolvedValue({ id: 'user-1' });
    workspaceRepository.findOneBy.mockResolvedValue({ id: 'workspace-1' });
    workspaceMemberRepository.findOneBy.mockResolvedValue({
      id: 'member-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      roleKey: 'member',
      status: 'pending',
    });
    workspaceMemberRepository.updateOne.mockResolvedValue({
      id: 'member-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      roleKey: 'member',
      status: 'active',
    });

    const result = await structuredService.addMember({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      status: 'active',
    });

    expect(result.status).toBe('active');
    expect(principalRoleBindingRepository.deleteByScope).toHaveBeenCalledWith(
      {
        principalType: 'user',
        principalId: 'user-1',
        scopeType: 'workspace',
        scopeId: 'workspace-1',
      },
      { tx: { id: 'tx' } },
    );
    expect(principalRoleBindingRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: 'user-1',
        scopeType: 'workspace',
        scopeId: 'workspace-1',
        roleId: 'role-viewer',
      }),
      { tx: { id: 'tx' } },
    );
  });

  it('removes structured binding when membership is downgraded to pending', async () => {
    const principalRoleBindingRepository = {
      deleteByScope: jest.fn().mockResolvedValue(1),
      createOne: jest.fn(),
    };
    const structuredService = new WorkspaceService({
      workspaceRepository,
      workspaceMemberRepository,
      userRepository,
      roleRepository: {
        findByNames: jest.fn(),
      } as any,
      principalRoleBindingRepository: principalRoleBindingRepository as any,
    });

    workspaceMemberRepository.findOneBy.mockResolvedValue({
      id: 'member-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      roleKey: 'member',
      status: 'active',
    });
    workspaceMemberRepository.updateOne.mockResolvedValue({
      id: 'member-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      roleKey: 'member',
      status: 'pending',
    });

    const result = await structuredService.updateMember({
      workspaceId: 'workspace-1',
      memberId: 'member-1',
      status: 'pending',
    });

    expect(result.status).toBe('pending');
    expect(principalRoleBindingRepository.deleteByScope).toHaveBeenCalledWith(
      {
        principalType: 'user',
        principalId: 'user-1',
        scopeType: 'workspace',
        scopeId: 'workspace-1',
      },
      { tx: { id: 'tx' } },
    );
    expect(principalRoleBindingRepository.createOne).not.toHaveBeenCalled();
  });

  it('creates workspace with generated unique slug', async () => {
    userRepository.findOneBy.mockResolvedValue({ id: 'user-1' });
    workspaceRepository.findOneBy
      .mockResolvedValueOnce({ id: 'existing', slug: 'demo' })
      .mockResolvedValueOnce(null);
    workspaceRepository.createOne.mockImplementation(async (payload: any) => ({
      ...payload,
    }));
    workspaceMemberRepository.createOne.mockResolvedValue({
      id: 'member-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      roleKey: 'owner',
      status: 'active',
    });

    const result = await service.createWorkspace({
      name: 'Demo',
      initialOwnerUserId: 'user-1',
    });

    expect(result.slug).toBe('demo-2');
    expect(result.status).toBe('active');
    expect(result.kind).toBe('regular');
  });

  it('lists active workspaces for a user', async () => {
    userRepository.findOneBy.mockResolvedValue({
      id: 'user-1',
      isPlatformAdmin: false,
    });
    workspaceMemberRepository.findAllBy.mockResolvedValue([
      { workspaceId: 'workspace-1', userId: 'user-1', status: 'active' },
      { workspaceId: 'workspace-2', userId: 'user-1', status: 'active' },
    ]);
    workspaceRepository.findOneBy
      .mockResolvedValueOnce({ id: 'workspace-1', name: 'A' })
      .mockResolvedValueOnce({ id: 'workspace-2', name: 'B' });

    const result = await service.listWorkspacesForUser('user-1');

    expect(result).toHaveLength(2);
    expect(result.map((workspace) => workspace.id)).toEqual([
      'workspace-1',
      'workspace-2',
    ]);
  });

  it('lists all active workspaces for platform admin', async () => {
    userRepository.findOneBy.mockResolvedValue({
      id: 'user-1',
      isPlatformAdmin: true,
    });
    workspaceRepository.findAllBy.mockResolvedValue([
      { id: 'workspace-1', name: 'A', status: 'active' },
      { id: 'workspace-2', name: 'B', status: 'active' },
      { id: 'workspace-3', name: 'C', status: 'active' },
    ]);

    const result = await service.listWorkspacesForUser('user-1');

    expect(workspaceMemberRepository.findAllBy).not.toHaveBeenCalled();
    expect(workspaceRepository.findAllBy).toHaveBeenCalledWith({
      status: 'active',
    });
    expect(result.map((workspace) => workspace.id)).toEqual([
      'workspace-1',
      'workspace-2',
      'workspace-3',
    ]);
  });

  it('lists all active workspaces when platform admin comes from structured bindings', async () => {
    const structuredService = new WorkspaceService({
      workspaceRepository,
      workspaceMemberRepository,
      userRepository,
      principalRoleBindingRepository: {
        findResolvedRoleBindings: jest.fn().mockResolvedValue([
          { roleName: 'platform_admin' },
        ]),
      } as any,
    });

    userRepository.findOneBy.mockResolvedValue({
      id: 'user-1',
      isPlatformAdmin: false,
    });
    workspaceRepository.findAllBy.mockResolvedValue([
      { id: 'workspace-1', name: 'A', status: 'active' },
      { id: 'workspace-2', name: 'B', status: 'active' },
    ]);

    const result = await structuredService.listWorkspacesForUser('user-1');

    expect(workspaceMemberRepository.findAllBy).not.toHaveBeenCalled();
    expect(result.map((workspace) => workspace.id)).toEqual([
      'workspace-1',
      'workspace-2',
    ]);
  });

  it('updates an existing membership when status changes', async () => {
    userRepository.findOneBy.mockResolvedValue({ id: 'user-1' });
    workspaceRepository.findOneBy.mockResolvedValue({ id: 'workspace-1' });
    workspaceMemberRepository.findOneBy.mockResolvedValue({
      id: 'member-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      roleKey: 'member',
      status: 'pending',
    });
    workspaceMemberRepository.updateOne.mockResolvedValue({
      id: 'member-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      roleKey: 'member',
      status: 'active',
    });

    const result = await service.addMember({
      workspaceId: 'workspace-1',
      userId: 'user-1',
      status: 'active',
    });

    expect(workspaceMemberRepository.updateOne).toHaveBeenCalledWith(
      'member-1',
      { status: 'active' },
      { tx: { id: 'tx' } },
    );
    expect(result.status).toBe('active');
  });

  it('invites an existing user by email', async () => {
    userRepository.findOneBy.mockResolvedValue({
      id: 'user-2',
      email: 'member@example.com',
    });
    workspaceMemberRepository.findOneBy.mockResolvedValue(null);
    workspaceRepository.findOneBy.mockResolvedValue({ id: 'workspace-1' });
    workspaceMemberRepository.createOne.mockResolvedValue({
      id: 'member-2',
      workspaceId: 'workspace-1',
      userId: 'user-2',
      roleKey: 'admin',
      status: 'invited',
    });

    const result = await service.inviteMemberByEmail({
      workspaceId: 'workspace-1',
      email: 'member@example.com',
      roleKey: 'admin',
      status: 'invited',
    });

    expect(result.roleKey).toBe('admin');
    expect(result.status).toBe('invited');
  });

  it('updates default workspace preference when membership is active', async () => {
    workspaceMemberRepository.findOneBy.mockResolvedValue({
      id: 'member-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      status: 'active',
    });

    await service.updateDefaultWorkspace({
      validatedSession,
      defaultWorkspaceId: 'workspace-1',
    });

    expect(userRepository.updateOne).toHaveBeenCalledWith('user-1', {
      defaultWorkspaceId: 'workspace-1',
    });
  });

  it('rejects mutating an owner membership through generic member updates', async () => {
    workspaceMemberRepository.findOneBy.mockResolvedValue({
      id: 'member-owner',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      roleKey: 'owner',
      status: 'active',
    });

    await expect(
      service.updateMember({
        workspaceId: 'workspace-1',
        memberId: 'member-owner',
        roleKey: 'admin',
      }),
    ).rejects.toThrow('Owner membership cannot be changed here');

    expect(workspaceMemberRepository.updateOne).not.toHaveBeenCalled();
  });

  it('rejects removing an owner membership through generic member removal', async () => {
    workspaceMemberRepository.findOneBy.mockResolvedValue({
      id: 'member-owner',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      roleKey: 'owner',
      status: 'active',
    });

    await expect(
      service.removeMember({
        workspaceId: 'workspace-1',
        memberId: 'member-owner',
      }),
    ).rejects.toThrow('Owner membership cannot be changed here');

    expect(workspaceMemberRepository.deleteOne).not.toHaveBeenCalled();
  });

  it('rejects updating a member from another workspace', async () => {
    workspaceMemberRepository.findOneBy.mockResolvedValue({
      id: 'member-2',
      workspaceId: 'workspace-2',
      userId: 'user-2',
      roleKey: 'member',
      status: 'active',
    });

    await expect(
      service.updateMember({
        workspaceId: 'workspace-1',
        memberId: 'member-2',
        status: 'inactive',
      }),
    ).rejects.toThrow('Workspace member member-2 not found');
  });

  it('rejects setting default workspace for another user via caller-supplied payload', async () => {
    workspaceMemberRepository.findOneBy.mockResolvedValue(null);

    await expect(
      service.updateDefaultWorkspace({
        validatedSession,
        defaultWorkspaceId: 'workspace-2',
      }),
    ).rejects.toThrow('Active workspace membership is required');

    expect(userRepository.updateOne).not.toHaveBeenCalled();
  });
});
