import bcrypt from 'bcryptjs';
import { AuthService } from '../authService';

describe('AuthService', () => {
  let service: AuthService;
  let userRepository: any;
  let authIdentityRepository: any;
  let authSessionRepository: any;
  let workspaceRepository: any;
  let workspaceMemberRepository: any;
  const tx = { id: 'tx' };

  beforeEach(() => {
    userRepository = {
      findAll: jest.fn(),
      findOneBy: jest.fn(),
      createOne: jest.fn(),
      transaction: jest.fn().mockResolvedValue(tx),
      commit: jest.fn(),
      rollback: jest.fn(),
    };
    authIdentityRepository = {
      findOneBy: jest.fn(),
      createOne: jest.fn(),
    };
    authSessionRepository = {
      findOneBy: jest.fn(),
      createOne: jest.fn(),
      updateOne: jest.fn(),
    };
    workspaceRepository = {
      findOneBy: jest.fn(),
      createOne: jest.fn(),
    };
    workspaceMemberRepository = {
      findOneBy: jest.fn(),
      findAllBy: jest.fn(),
      createOne: jest.fn(),
    };

    service = new AuthService({
      userRepository,
      authIdentityRepository,
      authSessionRepository,
      workspaceRepository,
      workspaceMemberRepository,
      sessionTtlMs: 60_000,
    });
  });

  it('bootstraps owner on a fresh instance', async () => {
    userRepository.findAll.mockResolvedValue([]);
    workspaceRepository.findOneBy.mockResolvedValue(null);
    workspaceRepository.createOne.mockResolvedValue({
      id: 'workspace-1',
      slug: 'demo',
      name: 'Demo',
      status: 'active',
    });
    userRepository.createOne.mockResolvedValue({
      id: 'user-1',
      email: 'owner@example.com',
      displayName: 'Owner',
      status: 'active',
    });
    authIdentityRepository.createOne.mockImplementation(async (payload: any) => ({
      ...payload,
    }));
    workspaceMemberRepository.createOne.mockResolvedValue({
      id: 'member-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      roleKey: 'owner',
      status: 'active',
    });
    authSessionRepository.createOne.mockImplementation(async (payload: any) => ({
      ...payload,
    }));

    const result = await service.bootstrapOwner({
      email: 'Owner@Example.com',
      password: 's3cret',
      displayName: 'Owner',
      workspaceName: 'Demo',
    });

    expect(result.user.email).toBe('owner@example.com');
    expect(result.workspace.slug).toBe('demo');
    expect(result.actorClaims.roleKeys).toEqual(['owner']);
    expect(result.sessionToken).toHaveLength(64);
    expect(userRepository.commit).toHaveBeenCalledWith(tx);
    const identityPayload = authIdentityRepository.createOne.mock.calls[0][0];
    await expect(
      bcrypt.compare('s3cret', identityPayload.passwordHash),
    ).resolves.toBe(true);
  });

  it('logs in a local user and returns actor claims', async () => {
    const passwordHash = await bcrypt.hash('passw0rd', 10);
    authIdentityRepository.findOneBy.mockResolvedValue({
      id: 'identity-1',
      userId: 'user-1',
      providerType: 'local',
      providerSubject: 'member@example.com',
      passwordHash,
    });
    userRepository.findOneBy.mockResolvedValue({
      id: 'user-1',
      email: 'member@example.com',
      displayName: 'Member',
      status: 'active',
    });
    workspaceMemberRepository.findOneBy.mockResolvedValue({
      id: 'member-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      roleKey: 'member',
      status: 'active',
    });
    workspaceRepository.findOneBy.mockResolvedValue({
      id: 'workspace-1',
      slug: 'demo',
      name: 'Demo',
      status: 'active',
    });
    authSessionRepository.createOne.mockImplementation(async (payload: any) => ({
      ...payload,
    }));

    const result = await service.login({
      email: 'member@example.com',
      password: 'passw0rd',
      workspaceId: 'workspace-1',
    });

    expect(result.user.id).toBe('user-1');
    expect(result.workspace.id).toBe('workspace-1');
    expect(result.actorClaims.permissionScopes).toContain('knowledge_base:read');
  });

  it('revokes a session on logout', async () => {
    authSessionRepository.findOneBy.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      revokedAt: null,
    });

    await service.logout('plain-session-token');

    expect(authSessionRepository.updateOne).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ revokedAt: expect.any(Date) }),
    );
  });
});
