import {
  assertAuthorizedWithAudit,
  recordAuditEvent,
} from './authorizationAudit';
import { AuthorizationActor } from './authorizationActor';
import { AuthorizationError } from './authorize';

describe('authorizationAudit', () => {
  const buildActor = (
    overrides: Partial<AuthorizationActor> = {},
  ): AuthorizationActor => ({
    principalType: 'user',
    principalId: 'user-1',
    workspaceId: 'workspace-1',
    workspaceMemberId: 'member-1',
    workspaceRoleKeys: ['owner'],
    permissionScopes: ['workspace:workspace-1'],
    isPlatformAdmin: false,
    platformRoleKeys: [],
    grantedActions: ['knowledge_base.read'],
    workspaceRoleSource: 'role_binding',
    platformRoleSource: 'legacy',
    sessionId: 'session-1',
    ...overrides,
  });

  const resource = {
    resourceType: 'knowledge_base',
    resourceId: 'kb-1',
    workspaceId: 'workspace-1',
  };

  const context = {
    requestId: 'request-1',
    sessionId: 'session-1',
    ipAddress: '127.0.0.1',
    userAgent: 'jest',
    runtimeScope: {
      workspace: {
        id: 'workspace-1',
      },
    },
  };

  it('records allowed audit events', async () => {
    const auditEventRepository = {
      createOne: jest.fn().mockResolvedValue(undefined),
    };

    await recordAuditEvent({
      auditEventRepository: auditEventRepository as any,
      actor: buildActor(),
      action: 'knowledge_base.read',
      resource,
      result: 'allowed',
      reason: 'granted by test',
      context,
      payloadJson: { source: 'unit-test' },
    });

    expect(auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        actorType: 'user',
        actorId: 'user-1',
        action: 'knowledge_base.read',
        resourceType: 'knowledge_base',
        resourceId: 'kb-1',
        result: 'allowed',
        requestId: 'request-1',
        sessionId: 'session-1',
        payloadJson: {
          source: 'unit-test',
          reason: 'granted by test',
        },
      }),
    );
  });

  it('records denied audit events before throwing', async () => {
    const auditEventRepository = {
      createOne: jest.fn().mockResolvedValue(undefined),
    };

    await expect(
      assertAuthorizedWithAudit({
        auditEventRepository: auditEventRepository as any,
        actor: null,
        action: 'knowledge_base.read',
        resource,
        context,
      }),
    ).rejects.toMatchObject<Partial<AuthorizationError>>({
      name: 'AuthorizationError',
      statusCode: 401,
      message: 'Authentication required',
    });

    expect(auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        actorType: 'system',
        result: 'denied',
        reason: 'Authentication required',
      }),
    );
  });

  it('does not emit audit rows on allowed authorize checks', async () => {
    const auditEventRepository = {
      createOne: jest.fn().mockResolvedValue(undefined),
    };

    const decision = await assertAuthorizedWithAudit({
      auditEventRepository: auditEventRepository as any,
      actor: buildActor(),
      action: 'knowledge_base.read',
      resource,
      context,
    });

    expect(decision).toEqual(
      expect.objectContaining({
        allowed: true,
        action: 'knowledge_base.read',
        statusCode: 200,
      }),
    );
    expect(auditEventRepository.createOne).not.toHaveBeenCalled();
  });

  it('records succeeded audit events', async () => {
    const auditEventRepository = {
      createOne: jest.fn().mockResolvedValue(undefined),
    };

    await recordAuditEvent({
      auditEventRepository: auditEventRepository as any,
      actor: buildActor(),
      action: 'knowledge_base.update',
      resource,
      result: 'succeeded',
      context,
      beforeJson: { name: 'before' },
      afterJson: { name: 'after' },
    });

    expect(auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.update',
        result: 'succeeded',
        beforeJson: { name: 'before' },
        afterJson: { name: 'after' },
      }),
    );
  });

  it('records failed audit events', async () => {
    const auditEventRepository = {
      createOne: jest.fn().mockResolvedValue(undefined),
    };

    await recordAuditEvent({
      auditEventRepository: auditEventRepository as any,
      actor: buildActor(),
      action: 'knowledge_base.update',
      resource,
      result: 'failed',
      reason: 'write failed',
      context,
    });

    expect(auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.update',
        result: 'failed',
        reason: 'write failed',
      }),
    );
  });

  it('records platform-scoped audit rows without workspaceId', async () => {
    const auditEventRepository = {
      createOne: jest.fn().mockResolvedValue(undefined),
    };

    await expect(
      recordAuditEvent({
        auditEventRepository: auditEventRepository as any,
        actor: {
          ...buildActor(),
          workspaceId: null,
          isPlatformAdmin: true,
          platformRoleKeys: ['platform_admin'],
          grantedActions: ['workspace.create'],
        },
        action: 'workspace.create',
        resource: {
          resourceType: 'workspace',
          resourceId: 'new',
          workspaceId: null,
        },
        result: 'allowed',
        context: {
          ...context,
          runtimeScope: null,
        },
      }),
    ).resolves.toBeUndefined();

    expect(auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: null,
        scopeType: 'platform',
        scopeId: 'platform',
        action: 'workspace.create',
      }),
    );
  });

  it('does not throw when audit repository write fails', async () => {
    const auditEventRepository = {
      createOne: jest.fn().mockRejectedValue(new Error('fk violation')),
    };

    await expect(
      recordAuditEvent({
        auditEventRepository: auditEventRepository as any,
        actor: buildActor(),
        action: 'knowledge_base.read',
        resource,
        result: 'allowed',
        context,
      }),
    ).resolves.toBeUndefined();

    expect(auditEventRepository.createOne).toHaveBeenCalledTimes(1);
  });
});
