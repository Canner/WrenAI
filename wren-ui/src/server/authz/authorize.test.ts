import { authorize } from './authorize';

const originalBindingMode = process.env.WREN_AUTHORIZATION_BINDING_MODE;

const workspaceResource = {
  resourceType: 'workspace',
  resourceId: 'workspace-1',
  workspaceId: 'workspace-1',
};

describe('authorize', () => {
  afterEach(() => {
    if (originalBindingMode === undefined) {
      delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
    } else {
      process.env.WREN_AUTHORIZATION_BINDING_MODE = originalBindingMode;
    }
  });

  it('uses grantedActions instead of legacy roles in binding-only mode', () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';

    const decision = authorize({
      actor: {
        principalType: 'user',
        principalId: 'user-1',
        workspaceId: 'workspace-1',
        workspaceMemberId: 'member-1',
        workspaceRoleKeys: ['owner'],
        permissionScopes: ['workspace:*'],
        platformRoleKeys: [],
        isPlatformAdmin: false,
        grantedActions: undefined,
        workspaceRoleSource: 'legacy',
        platformRoleSource: 'legacy',
      },
      action: 'workspace.member.invite',
      resource: workspaceResource,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('Workspace manager permission required');
  });

  it('falls back to legacy role checks in dual-read mode', () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'dual_read';

    const decision = authorize({
      actor: {
        principalType: 'user',
        principalId: 'user-1',
        workspaceId: 'workspace-1',
        workspaceMemberId: 'member-1',
        workspaceRoleKeys: ['owner'],
        permissionScopes: ['workspace:*'],
        platformRoleKeys: [],
        isPlatformAdmin: false,
        grantedActions: undefined,
        workspaceRoleSource: 'legacy',
        platformRoleSource: 'legacy',
      },
      action: 'workspace.member.invite',
      resource: workspaceResource,
    });

    expect(decision.allowed).toBe(true);
  });

  it('allows workspace admin to read role catalog in dual-read mode', () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'dual_read';

    const decision = authorize({
      actor: {
        principalType: 'user',
        principalId: 'user-1',
        workspaceId: 'workspace-1',
        workspaceMemberId: 'member-1',
        workspaceRoleKeys: ['admin'],
        permissionScopes: ['workspace:*'],
        platformRoleKeys: [],
        isPlatformAdmin: false,
        grantedActions: undefined,
        workspaceRoleSource: 'legacy',
        platformRoleSource: 'legacy',
      },
      action: 'role.read',
      resource: workspaceResource,
    });

    expect(decision.allowed).toBe(true);
  });

  it('uses grantedActions for platform actions in binding-only mode', () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';

    const deniedDecision = authorize({
      actor: {
        principalType: 'user',
        principalId: 'user-1',
        workspaceId: 'workspace-1',
        workspaceMemberId: 'member-1',
        workspaceRoleKeys: [],
        permissionScopes: [],
        platformRoleKeys: ['platform_admin'],
        isPlatformAdmin: true,
        grantedActions: [],
        workspaceRoleSource: 'role_binding',
        platformRoleSource: 'role_binding',
      },
      action: 'workspace.create',
      resource: {
        resourceType: 'workspace',
        resourceId: 'new',
        workspaceId: 'workspace-1',
      },
    });
    expect(deniedDecision.allowed).toBe(false);

    const allowedDecision = authorize({
      actor: {
        principalType: 'user',
        principalId: 'user-1',
        workspaceId: 'workspace-1',
        workspaceMemberId: 'member-1',
        workspaceRoleKeys: [],
        permissionScopes: [],
        platformRoleKeys: ['platform_admin'],
        isPlatformAdmin: true,
        grantedActions: ['workspace.create'],
        workspaceRoleSource: 'role_binding',
        platformRoleSource: 'role_binding',
      },
      action: 'workspace.create',
      resource: {
        resourceType: 'workspace',
        resourceId: 'new',
        workspaceId: 'workspace-1',
      },
    });
    expect(allowedDecision.allowed).toBe(true);
  });

  it('does not fall back to platform admin boolean when role source is role_binding without actions', () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'dual_read';

    const decision = authorize({
      actor: {
        principalType: 'user',
        principalId: 'user-1',
        workspaceId: 'workspace-1',
        workspaceMemberId: 'member-1',
        workspaceRoleKeys: [],
        permissionScopes: [],
        platformRoleKeys: ['platform_admin'],
        isPlatformAdmin: true,
        grantedActions: undefined,
        workspaceRoleSource: 'role_binding',
        platformRoleSource: 'role_binding',
      },
      action: 'workspace.create',
      resource: {
        resourceType: 'workspace',
        resourceId: 'new',
        workspaceId: 'workspace-1',
      },
    });

    expect(decision.allowed).toBe(false);
  });

  it('allows platform admin to read the selected workspace without explicit workspace grants', () => {
    const decision = authorize({
      actor: {
        principalType: 'user',
        principalId: 'user-1',
        workspaceId: 'workspace-2',
        workspaceMemberId: 'platform_admin:workspace-2:user-1',
        workspaceRoleKeys: ['admin'],
        permissionScopes: [],
        platformRoleKeys: ['platform_admin'],
        isPlatformAdmin: true,
        grantedActions: [],
        workspaceRoleSource: 'role_binding',
        platformRoleSource: 'role_binding',
      },
      action: 'workspace.read',
      resource: {
        resourceType: 'workspace',
        resourceId: 'workspace-2',
        workspaceId: 'workspace-2',
      },
    });

    expect(decision.allowed).toBe(true);
  });

  it('allows platform admin to manage workspace members across workspaces', () => {
    const decision = authorize({
      actor: {
        principalType: 'user',
        principalId: 'user-1',
        workspaceId: 'workspace-2',
        workspaceMemberId: 'platform_admin:workspace-2:user-1',
        workspaceRoleKeys: ['admin'],
        permissionScopes: [],
        platformRoleKeys: ['platform_admin'],
        isPlatformAdmin: true,
        grantedActions: [],
        workspaceRoleSource: 'role_binding',
        platformRoleSource: 'role_binding',
      },
      action: 'workspace.member.role.update',
      resource: {
        resourceType: 'workspace_member',
        resourceId: 'member-2',
        workspaceId: 'workspace-2',
        attributes: {
          workspaceKind: 'regular',
          targetRoleKey: 'owner',
          nextRoleKey: 'admin',
          targetUserId: 'user-2',
        },
      },
    });

    expect(decision.allowed).toBe(true);
  });
});
