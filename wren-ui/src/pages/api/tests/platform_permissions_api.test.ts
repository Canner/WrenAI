import {
  createReq,
  createRes,
  mockAssertAuthorizedWithAudit,
  mockCreatePermissions,
  mockBuildAuthorizationActorFromValidatedSession,
  mockCreateRole,
  mockCreateRolePermissions,
  mockDeleteRole,
  mockDeleteRolePermissions,
  mockGetRole,
  mockListPermissions,
  mockListRolePermissions,
  mockListRoles,
  mockUpdateRole,
  mockValidateSession,
  platformAdminActor,
  platformAdminSession,
  resetPlatformApiTestEnv,
} from './platform_api.testSupport';

const PLATFORM_ADMIN_ROLE = {
  id: 'role-platform-admin',
  name: 'platform_admin',
  displayName: '平台管理员',
  scopeType: 'platform',
  scopeId: '',
  description: '管理平台级菜单、跨空间治理与高风险平台动作。',
  isSystem: true,
  isActive: true,
  createdBy: null,
};

const PLATFORM_PERMISSION_ROWS = [
  {
    id: 'perm-workspace-create',
    name: 'workspace.create',
    scopeType: 'platform',
    description: 'Create a new workspace',
  },
  {
    id: 'perm-break-glass-manage',
    name: 'break_glass.manage',
    scopeType: 'platform',
    description: 'Manage emergency break-glass grants',
  },
  {
    id: 'perm-impersonation-start',
    name: 'impersonation.start',
    scopeType: 'platform',
    description: 'Start an audited impersonation session',
  },
];

describe('platform permissions api route', () => {
  beforeEach(() => {
    resetPlatformApiTestEnv();
  });

  it('GET /platform/permissions returns role catalog and platform permission catalog', async () => {
    const handler = (await import('../v1/platform/permissions/index')).default;
    const req = createReq({
      headers: { cookie: 'wren_session=session-token' },
    });
    const res = createRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'platform_admin',
          displayName: '平台管理员',
          permissionNames: expect.arrayContaining([
            'workspace.create',
            'break_glass.manage',
            'impersonation.start',
          ]),
        }),
        expect.objectContaining({
          name: 'platform_iam_admin',
          displayName: '平台权限管理员',
        }),
        expect.objectContaining({
          name: 'platform_workspace_admin',
          displayName: '平台空间管理员',
          permissionNames: expect.arrayContaining([
            'platform.system_task.read',
            'platform.system_task.manage',
          ]),
        }),
        expect.objectContaining({
          name: 'platform_auditor',
          displayName: '平台审计员',
        }),
        expect.objectContaining({
          name: 'support_readonly',
          displayName: '支持只读',
          permissionNames: expect.arrayContaining([
            'platform.audit.read',
            'platform.diagnostics.read',
            'platform.system_task.read',
          ]),
        }),
        expect.objectContaining({
          name: 'support_impersonator',
          displayName: '支持代理员',
          permissionNames: expect.arrayContaining(['impersonation.start']),
        }),
      ]),
    );
    expect(res.body.permissionCatalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'platform.user.read',
          scope: 'platform',
        }),
        expect.objectContaining({
          name: 'platform.role.read',
          scope: 'platform',
        }),
        expect.objectContaining({
          name: 'platform.workspace.read',
          scope: 'platform',
        }),
        expect.objectContaining({
          name: 'workspace.create',
          scope: 'platform',
        }),
        expect.objectContaining({
          name: 'break_glass.manage',
          scope: 'platform',
        }),
      ]),
    );
    expect(res.body.actor).toEqual(
      expect.objectContaining({
        principalId: 'user-1',
        platformRoleKeys: ['platform_admin'],
      }),
    );
  });

  it('GET /platform/permissions seeds default platform catalog when system roles are missing', async () => {
    const handler = (await import('../v1/platform/permissions/index')).default;
    const req = createReq({
      headers: { cookie: 'wren_session=session-token' },
    });
    const res = createRes();

    mockListRoles
      .mockResolvedValueOnce([])
      .mockResolvedValue([PLATFORM_ADMIN_ROLE]);
    mockListPermissions
      .mockResolvedValueOnce([])
      .mockResolvedValue(PLATFORM_PERMISSION_ROWS);
    mockListRolePermissions.mockResolvedValue([]);

    await handler(req, res);

    expect(mockCreatePermissions).toHaveBeenCalled();
    expect(mockCreateRole).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'platform_admin',
        scopeType: 'platform',
        scopeId: '',
        isSystem: true,
      }),
      expect.any(Object),
    );
    expect(mockCreateRole).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'platform_iam_admin',
        scopeType: 'platform',
        scopeId: '',
        isSystem: true,
      }),
      expect.any(Object),
    );
    expect(mockCreateRole).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'platform_workspace_admin',
        scopeType: 'platform',
        scopeId: '',
        isSystem: true,
      }),
      expect.any(Object),
    );
    expect(mockCreateRole).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'platform_auditor',
        scopeType: 'platform',
        scopeId: '',
        isSystem: true,
      }),
      expect.any(Object),
    );
    expect(mockCreateRole).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'support_readonly',
        scopeType: 'platform',
        scopeId: '',
        isSystem: true,
      }),
      expect.any(Object),
    );
    expect(mockCreateRole).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'support_impersonator',
        scopeType: 'platform',
        scopeId: '',
        isSystem: true,
      }),
      expect.any(Object),
    );
    expect(mockCreateRolePermissions).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ roleId: expect.any(String) }),
      ]),
      expect.any(Object),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'platform_admin',
          displayName: '平台管理员',
        }),
      ]),
    );
  });

  it('POST /platform/permissions creates a custom platform role', async () => {
    const handler = (await import('../v1/platform/permissions/index')).default;
    const req = createReq({
      method: 'POST',
      headers: { cookie: 'wren_session=session-token' },
      body: {
        name: 'workspace_operator',
        displayName: '空间运营',
        description: '负责空间创建和紧急治理',
        permissionNames: ['workspace.create', 'break_glass.manage'],
        isActive: true,
      },
    });
    const res = createRes();

    const createdRole = {
      id: 'role-custom-platform-1',
      name: 'workspace_operator',
      displayName: '空间运营',
      scopeType: 'platform',
      scopeId: '',
      description: '负责空间创建和紧急治理',
      isSystem: false,
      isActive: true,
      createdBy: 'user-1',
    };

    mockCreateRole.mockResolvedValue(createdRole);
    mockListRoles
      .mockResolvedValueOnce([PLATFORM_ADMIN_ROLE])
      .mockResolvedValueOnce([PLATFORM_ADMIN_ROLE])
      .mockResolvedValue([PLATFORM_ADMIN_ROLE, createdRole]);
    mockListRolePermissions.mockResolvedValue([
      {
        id: 'rp-platform-admin-workspace-create',
        roleId: 'role-platform-admin',
        permissionId: 'perm-workspace-create',
      },
      {
        id: 'rp-platform-admin-break-glass-manage',
        roleId: 'role-platform-admin',
        permissionId: 'perm-break-glass-manage',
      },
      {
        id: 'rp-platform-admin-impersonation-start',
        roleId: 'role-platform-admin',
        permissionId: 'perm-impersonation-start',
      },
      {
        id: 'rp-custom-workspace-create',
        roleId: 'role-custom-platform-1',
        permissionId: 'perm-workspace-create',
      },
      {
        id: 'rp-custom-break-glass-manage',
        roleId: 'role-custom-platform-1',
        permissionId: 'perm-break-glass-manage',
      },
    ]);

    await handler(req, res);

    expect(mockCreateRole).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'workspace_operator',
        displayName: '空间运营',
        scopeType: 'platform',
        scopeId: '',
        isSystem: false,
        createdBy: 'user-1',
      }),
      expect.any(Object),
    );
    expect(mockCreateRolePermissions).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          roleId: 'role-custom-platform-1',
          permissionId: 'perm-workspace-create',
        }),
        expect.objectContaining({
          roleId: 'role-custom-platform-1',
          permissionId: 'perm-break-glass-manage',
        }),
      ]),
      expect.any(Object),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.body.role).toEqual(
      expect.objectContaining({
        id: 'role-custom-platform-1',
        name: 'workspace_operator',
        permissionNames: ['break_glass.manage', 'workspace.create'],
      }),
    );
  });

  it('PATCH /platform/permissions/[id] updates a custom platform role', async () => {
    const handler = (await import('../v1/platform/permissions/[id]')).default;
    const req = createReq({
      method: 'PATCH',
      query: { id: 'role-custom-platform-1' },
      headers: { cookie: 'wren_session=session-token' },
      body: {
        name: 'risk_operator',
        displayName: '风险运营',
        description: '处理高风险平台动作',
        isActive: false,
        permissionNames: ['impersonation.start'],
      },
    });
    const res = createRes();

    const existingRole = {
      id: 'role-custom-platform-1',
      name: 'workspace_operator',
      displayName: '空间运营',
      scopeType: 'platform',
      scopeId: '',
      description: '负责空间创建和紧急治理',
      isSystem: false,
      isActive: true,
      createdBy: 'user-1',
    };
    const updatedRole = {
      ...existingRole,
      name: 'risk_operator',
      displayName: '风险运营',
      description: '处理高风险平台动作',
      isActive: false,
    };

    mockGetRole.mockResolvedValue(existingRole);
    mockListRoles
      .mockResolvedValueOnce([PLATFORM_ADMIN_ROLE, existingRole])
      .mockResolvedValueOnce([PLATFORM_ADMIN_ROLE, existingRole])
      .mockResolvedValueOnce([PLATFORM_ADMIN_ROLE, existingRole])
      .mockResolvedValueOnce([PLATFORM_ADMIN_ROLE, existingRole])
      .mockResolvedValue([PLATFORM_ADMIN_ROLE, updatedRole]);
    mockUpdateRole.mockResolvedValue(updatedRole);
    mockListRolePermissions.mockResolvedValue([
      {
        id: 'rp-platform-admin-workspace-create',
        roleId: 'role-platform-admin',
        permissionId: 'perm-workspace-create',
      },
      {
        id: 'rp-platform-admin-break-glass-manage',
        roleId: 'role-platform-admin',
        permissionId: 'perm-break-glass-manage',
      },
      {
        id: 'rp-platform-admin-impersonation-start',
        roleId: 'role-platform-admin',
        permissionId: 'perm-impersonation-start',
      },
      {
        id: 'rp-custom-impersonation-start',
        roleId: 'role-custom-platform-1',
        permissionId: 'perm-impersonation-start',
      },
    ]);

    await handler(req, res);

    expect(mockUpdateRole).toHaveBeenCalledWith(
      'role-custom-platform-1',
      expect.objectContaining({
        name: 'risk_operator',
        displayName: '风险运营',
        description: '处理高风险平台动作',
        isActive: false,
      }),
      expect.any(Object),
    );
    expect(mockDeleteRolePermissions).toHaveBeenCalledWith(
      { roleId: 'role-custom-platform-1' },
      expect.any(Object),
    );
    expect(mockCreateRolePermissions).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          roleId: 'role-custom-platform-1',
          permissionId: 'perm-impersonation-start',
        }),
      ],
      expect.any(Object),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.role).toEqual(
      expect.objectContaining({
        id: 'role-custom-platform-1',
        name: 'risk_operator',
        permissionNames: ['impersonation.start'],
      }),
    );
  });

  it('DELETE /platform/permissions/[id] deletes a custom platform role', async () => {
    const handler = (await import('../v1/platform/permissions/[id]')).default;
    const req = createReq({
      method: 'DELETE',
      query: { id: 'role-custom-platform-1' },
      headers: { cookie: 'wren_session=session-token' },
    });
    const res = createRes();

    mockGetRole.mockResolvedValue({
      id: 'role-custom-platform-1',
      name: 'workspace_operator',
      displayName: '空间运营',
      scopeType: 'platform',
      scopeId: '',
      description: '负责空间创建和紧急治理',
      isSystem: false,
      isActive: true,
      createdBy: 'user-1',
    });

    await handler(req, res);

    expect(mockDeleteRole).toHaveBeenCalledWith('role-custom-platform-1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body).toEqual({ roleId: 'role-custom-platform-1' });
  });

  it('rejects sessions without platform role read permission', async () => {
    const handler = (await import('../v1/platform/permissions/index')).default;
    const req = createReq({
      headers: { cookie: 'wren_session=session-token' },
    });
    const res = createRes();

    mockValidateSession.mockResolvedValue({
      ...platformAdminSession,
      user: {
        ...platformAdminSession.user,
        isPlatformAdmin: false,
      },
    });
    mockBuildAuthorizationActorFromValidatedSession.mockReturnValue({
      ...platformAdminActor,
      isPlatformAdmin: false,
      platformRoleKeys: [],
    });
    const permissionError = new Error(
      'Platform role read permission required',
    ) as Error & { statusCode?: number };
    permissionError.statusCode = 403;
    mockAssertAuthorizedWithAudit.mockRejectedValueOnce(permissionError);

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.body).toEqual({
      error: 'Platform role read permission required',
    });
  });

  it('allows platform IAM admins to read the platform role catalog', async () => {
    const handler = (await import('../v1/platform/permissions/index')).default;
    const req = createReq({
      headers: { cookie: 'wren_session=session-token' },
    });
    const res = createRes();

    mockValidateSession.mockResolvedValue({
      ...platformAdminSession,
      user: {
        ...platformAdminSession.user,
        isPlatformAdmin: false,
      },
      actorClaims: {
        ...platformAdminSession.actorClaims,
        isPlatformAdmin: false,
        platformRoleKeys: ['platform_iam_admin'],
        grantedActions: ['platform.role.read'],
      },
    });
    mockBuildAuthorizationActorFromValidatedSession.mockReturnValue({
      ...platformAdminActor,
      isPlatformAdmin: false,
      platformRoleKeys: ['platform_iam_admin'],
      grantedActions: ['platform.role.read'],
    });

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body.roles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'platform_admin',
        }),
      ]),
    );
  });
});
