import {
  createReq,
  createRes,
  mockListKnowledgeBases,
  mockStartImpersonation,
  mockStopImpersonation,
  mockValidateSession,
} from './auth_api.testSupport';
import { resetAuthApiMocks } from './auth_api.testSupport';

describe('pages/api/auth routes', () => {
  beforeEach(() => {
    resetAuthApiMocks();
  });

  it('starts impersonation and returns runtime selector', async () => {
    const handler = (await import('../../pages/api/auth/impersonation/start'))
      .default;
    const req = createReq({
      method: 'POST',
      headers: {
        cookie: 'wren_session=session-token',
      },
      body: {
        targetUserId: 'user-2',
        reason: 'support-debug',
      },
    });
    const res = createRes();

    mockValidateSession.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'owner@example.com',
        isPlatformAdmin: true,
        defaultWorkspaceId: 'workspace-1',
        displayName: 'Owner',
      },
      workspace: {
        id: 'workspace-1',
        name: 'Demo Workspace',
        slug: 'demo',
        kind: 'regular',
      },
      membership: {
        id: 'member-1',
        roleKey: 'owner',
      },
      session: {
        id: 'session-1',
        impersonatorUserId: null,
        impersonationReason: null,
      },
      actorClaims: {
        workspaceId: 'workspace-1',
        workspaceMemberId: 'member-1',
        roleKeys: ['owner'],
        permissionScopes: ['workspace:*', 'knowledge_base:*'],
        grantedActions: ['impersonation.start'],
        isPlatformAdmin: true,
        platformRoleKeys: ['platform_admin'],
        workspaceRoleSource: 'role_binding',
        platformRoleSource: 'role_binding',
      },
    });
    mockStartImpersonation.mockResolvedValue({
      sessionToken: 'impersonation-token',
      user: {
        id: 'user-2',
        email: 'member@example.com',
      },
      workspace: {
        id: 'workspace-1',
        name: 'Demo Workspace',
      },
      membership: {
        id: 'member-2',
        roleKey: 'member',
      },
      actorClaims: {
        workspaceId: 'workspace-1',
        roleKeys: ['member'],
      },
    });
    mockListKnowledgeBases.mockResolvedValue([
      {
        id: 'kb-a',
        workspaceId: 'workspace-1',
        name: 'Alpha KB',
        defaultKbSnapshotId: null,
      },
    ]);

    await handler(req, res);

    expect(mockStartImpersonation).toHaveBeenCalledWith({
      validatedSession: expect.objectContaining({
        user: expect.objectContaining({ id: 'user-1' }),
        workspace: expect.objectContaining({ id: 'workspace-1' }),
      }),
      targetUserId: 'user-2',
      workspaceId: undefined,
      reason: 'support-debug',
    });
    expect(res.getHeader('Set-Cookie')).toContain(
      'wren_session=impersonation-token',
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        ok: true,
        runtimeSelector: {
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-a',
          kbSnapshotId: null,
          deployHash: null,
        },
      }),
    );
  });

  it('stops impersonation and restores original session', async () => {
    const handler = (await import('../../pages/api/auth/impersonation/stop'))
      .default;
    const req = createReq({
      method: 'POST',
      headers: {
        cookie: 'wren_session=session-token',
      },
    });
    const res = createRes();

    mockValidateSession.mockResolvedValue({
      session: {
        id: 'session-imp',
        impersonatorUserId: 'user-1',
        impersonationReason: 'support-debug',
      },
      user: {
        id: 'user-2',
        email: 'member@example.com',
        isPlatformAdmin: false,
        defaultWorkspaceId: 'workspace-1',
        displayName: 'Member',
      },
      workspace: {
        id: 'workspace-1',
        name: 'Demo Workspace',
        slug: 'demo',
        kind: 'regular',
      },
      membership: {
        id: 'member-2',
        roleKey: 'member',
      },
      actorClaims: {
        workspaceId: 'workspace-1',
        workspaceMemberId: 'member-2',
        roleKeys: ['member'],
        permissionScopes: ['workspace:read', 'knowledge_base:read'],
      },
    });
    mockStopImpersonation.mockResolvedValue({
      sessionToken: 'restored-token',
      user: {
        id: 'user-1',
        email: 'owner@example.com',
      },
      workspace: {
        id: 'workspace-1',
        name: 'Demo Workspace',
      },
      membership: {
        id: 'member-1',
        roleKey: 'owner',
      },
      actorClaims: {
        workspaceId: 'workspace-1',
        roleKeys: ['owner'],
      },
    });
    mockListKnowledgeBases.mockResolvedValue([
      {
        id: 'kb-a',
        workspaceId: 'workspace-1',
        name: 'Alpha KB',
        defaultKbSnapshotId: null,
      },
    ]);

    await handler(req, res);

    expect(mockStopImpersonation).toHaveBeenCalled();
    expect(res.getHeader('Set-Cookie')).toContain(
      'wren_session=restored-token',
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        ok: true,
        runtimeSelector: {
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-a',
          kbSnapshotId: null,
          deployHash: null,
        },
      }),
    );
  });
});

export {};
