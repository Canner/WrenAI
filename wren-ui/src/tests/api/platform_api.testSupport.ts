export {};

export const mockValidateSession = jest.fn();
export const mockGetSessionTokenFromRequest = jest.fn();
export const mockBuildAuthorizationActorFromValidatedSession = jest.fn();
export const mockBuildAuthorizationContextFromRequest = jest.fn();
export const mockAssertAuthorizedWithAudit = jest.fn();
export const mockRecordAuditEvent = jest.fn();
export const mockSearchAuditEvents = jest.fn();

export const mockListUsers = jest.fn();
export const mockListUsersBy = jest.fn();
export const mockGetUser = jest.fn();
export const mockUpdateUser = jest.fn();
export const mockRegisterLocalUser = jest.fn();
export const mockLogout = jest.fn();

export const mockListWorkspaces = jest.fn();
export const mockGetWorkspace = jest.fn();

export const mockListWorkspaceMembers = jest.fn();
export const mockGetWorkspaceMember = jest.fn();

export const mockListKnowledgeBases = jest.fn();
export const mockGetKnowledgeBase = jest.fn();
export const mockListConnectors = jest.fn();
export const mockListSkills = jest.fn();

export const mockListWorkspacesForUser = jest.fn();
export const mockCreateWorkspace = jest.fn();
export const mockAddWorkspaceMember = jest.fn();
export const mockUpdateWorkspaceMember = jest.fn();
export const mockRemoveWorkspaceMember = jest.fn();

export const mockListRoles = jest.fn();
export const mockGetRole = jest.fn();
export const mockCreateRole = jest.fn();
export const mockUpdateRole = jest.fn();
export const mockDeleteRole = jest.fn();
export const mockRoleTransaction = jest.fn();
export const mockRoleCommit = jest.fn();
export const mockRoleRollback = jest.fn();
export const mockListPermissions = jest.fn();
export const mockCreatePermissions = jest.fn();
export const mockListRolePermissions = jest.fn();
export const mockCreateRolePermissions = jest.fn();
export const mockDeleteRolePermissions = jest.fn();
export const mockListPrincipalRoleBindings = jest.fn();
export const mockCreatePrincipalRoleBinding = jest.fn();
export const mockDeletePrincipalRoleBindingsByScope = jest.fn();
export const mockCountApiHistory = jest.fn();
export const mockListApiHistoryWithPagination = jest.fn();
export const mockListScheduleJobs = jest.fn();
export const mockGetScheduleJob = jest.fn();
export const mockListScheduleRuns = jest.fn();
export const mockListScheduleRunsByJobIds = jest.fn();
export const mockGetDashboard = jest.fn();
export const mockSetDashboardSchedule = jest.fn();
export const mockSyncDashboardRefreshJob = jest.fn();
export const mockRunJobNow = jest.fn();
export const mockGetKbSnapshot = jest.fn();

jest.mock('@/common', () => ({
  components: {
    authService: {
      validateSession: (...args: any[]) => mockValidateSession(...args),
      registerLocalUser: (...args: any[]) => mockRegisterLocalUser(...args),
      logout: (...args: any[]) => mockLogout(...args),
    },
    userRepository: {
      findAll: (...args: any[]) => mockListUsers(...args),
      findAllBy: (...args: any[]) => mockListUsersBy(...args),
      findOneBy: (...args: any[]) => mockGetUser(...args),
      updateOne: (...args: any[]) => mockUpdateUser(...args),
    },
    workspaceRepository: {
      findAllBy: (...args: any[]) => mockListWorkspaces(...args),
      findOneBy: (...args: any[]) => mockGetWorkspace(...args),
    },
    workspaceMemberRepository: {
      findAll: (...args: any[]) => mockListWorkspaceMembers(...args),
      findAllBy: (...args: any[]) => mockListWorkspaceMembers(...args),
      findOneBy: (...args: any[]) => mockGetWorkspaceMember(...args),
    },
    knowledgeBaseRepository: {
      findAllBy: (...args: any[]) => mockListKnowledgeBases(...args),
      findOneBy: (...args: any[]) => mockGetKnowledgeBase(...args),
    },
    connectorRepository: {
      findAllBy: (...args: any[]) => mockListConnectors(...args),
    },
    skillDefinitionRepository: {
      findAllBy: (...args: any[]) => mockListSkills(...args),
    },
    workspaceService: {
      listWorkspacesForUser: (...args: any[]) =>
        mockListWorkspacesForUser(...args),
      createWorkspace: (...args: any[]) => mockCreateWorkspace(...args),
      addMember: (...args: any[]) => mockAddWorkspaceMember(...args),
      updateMember: (...args: any[]) => mockUpdateWorkspaceMember(...args),
      removeMember: (...args: any[]) => mockRemoveWorkspaceMember(...args),
    },
    roleRepository: {
      findAll: (...args: any[]) => mockListRoles(...args),
      findOneBy: (...args: any[]) => mockGetRole(...args),
      createOne: (...args: any[]) => mockCreateRole(...args),
      updateOne: (...args: any[]) => mockUpdateRole(...args),
      deleteOne: (...args: any[]) => mockDeleteRole(...args),
      transaction: (...args: any[]) => mockRoleTransaction(...args),
      commit: (...args: any[]) => mockRoleCommit(...args),
      rollback: (...args: any[]) => mockRoleRollback(...args),
    },
    permissionRepository: {
      findAll: (...args: any[]) => mockListPermissions(...args),
      createMany: (...args: any[]) => mockCreatePermissions(...args),
    },
    rolePermissionRepository: {
      findAll: (...args: any[]) => mockListRolePermissions(...args),
      createMany: (...args: any[]) => mockCreateRolePermissions(...args),
      deleteAllBy: (...args: any[]) => mockDeleteRolePermissions(...args),
    },
    principalRoleBindingRepository: {
      findAllBy: (...args: any[]) => mockListPrincipalRoleBindings(...args),
      createOne: (...args: any[]) => mockCreatePrincipalRoleBinding(...args),
      deleteByScope: (...args: any[]) =>
        mockDeletePrincipalRoleBindingsByScope(...args),
    },
    auditEventRepository: {
      search: (...args: any[]) => mockSearchAuditEvents(...args),
      createOne: jest.fn(),
    },
    apiHistoryRepository: {
      count: (...args: any[]) => mockCountApiHistory(...args),
      findAllWithPagination: (...args: any[]) =>
        mockListApiHistoryWithPagination(...args),
    },
    kbSnapshotRepository: {
      findOneBy: (...args: any[]) => mockGetKbSnapshot(...args),
    },
    scheduleJobRepository: {
      findAllBy: (...args: any[]) => mockListScheduleJobs(...args),
      findOneBy: (...args: any[]) => mockGetScheduleJob(...args),
    },
    scheduleJobRunRepository: {
      findAllBy: (...args: any[]) => mockListScheduleRuns(...args),
      findAllByScheduleJobIds: (...args: any[]) =>
        mockListScheduleRunsByJobIds(...args),
    },
    dashboardRepository: {
      findOneBy: (...args: any[]) => mockGetDashboard(...args),
    },
    dashboardService: {
      setDashboardSchedule: (...args: any[]) =>
        mockSetDashboardSchedule(...args),
    },
    scheduleService: {
      syncDashboardRefreshJob: (...args: any[]) =>
        mockSyncDashboardRefreshJob(...args),
    },
    scheduleWorker: {
      runJobNow: (...args: any[]) => mockRunJobNow(...args),
    },
  },
}));

jest.mock('@server/context/actorClaims', () => ({
  getSessionTokenFromRequest: (...args: any[]) =>
    mockGetSessionTokenFromRequest(...args),
}));

jest.mock('@server/authz', () => {
  const actual = jest.requireActual('@server/authz');
  return {
    ...actual,
    buildAuthorizationActorFromValidatedSession: (...args: any[]) =>
      mockBuildAuthorizationActorFromValidatedSession(...args),
    buildAuthorizationContextFromRequest: (...args: any[]) =>
      mockBuildAuthorizationContextFromRequest(...args),
    assertAuthorizedWithAudit: (...args: any[]) =>
      mockAssertAuthorizedWithAudit(...args),
    recordAuditEvent: (...args: any[]) => mockRecordAuditEvent(...args),
  };
});

export const createReq = (overrides: Partial<any> = {}) =>
  ({
    method: 'GET',
    body: {},
    query: {},
    headers: {},
    ...overrides,
  }) as any;

export const createRes = () => {
  const res: any = {
    statusCode: 200,
    body: undefined,
    setHeader: jest.fn(),
    status: jest.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: jest.fn((payload: any) => {
      res.body = payload;
      return res;
    }),
  };
  return res;
};

export const platformAdminSession = {
  workspace: {
    id: 'workspace-1',
    name: 'Demo Workspace',
    slug: 'demo',
    kind: 'regular',
  },
  membership: { id: 'member-1', roleKey: 'owner' },
  user: {
    id: 'user-1',
    email: 'owner@example.com',
    displayName: 'Owner',
    isPlatformAdmin: true,
    defaultWorkspaceId: 'workspace-1',
    status: 'active',
  },
  session: { id: 'session-1' },
  actorClaims: {
    workspaceId: 'workspace-1',
    workspaceMemberId: 'member-1',
    roleKeys: ['owner'],
    permissionScopes: ['workspace:*', 'platform:*'],
    grantedActions: [
      'workspace.read',
      'workspace.create',
      'workspace.member.invite',
      'workspace.member.role.update',
      'workspace.member.remove',
      'workspace.member.approve',
      'workspace.member.reject',
      'break_glass.manage',
      'impersonation.start',
    ],
    workspaceRoleSource: 'role_binding',
    isPlatformAdmin: true,
    platformRoleKeys: ['platform_admin'],
    platformRoleSource: 'role_binding',
  },
};

export const platformAdminActor = {
  principalType: 'user',
  principalId: 'user-1',
  workspaceId: 'workspace-1',
  workspaceMemberId: 'member-1',
  workspaceRoleKeys: ['owner'],
  permissionScopes: ['workspace:*', 'platform:*'],
  grantedActions: platformAdminSession.actorClaims.grantedActions,
  workspaceRoleSource: 'role_binding',
  isPlatformAdmin: true,
  platformRoleKeys: ['platform_admin'],
  platformRoleSource: 'role_binding',
  sessionId: 'session-1',
};

const defaultPlatformPermissions = [
  {
    id: 'perm-platform-user-read',
    name: 'platform.user.read',
    scopeType: 'platform',
    description: 'Read the platform user directory',
  },
  {
    id: 'perm-platform-user-create',
    name: 'platform.user.create',
    scopeType: 'platform',
    description: 'Create platform users',
  },
  {
    id: 'perm-platform-user-update',
    name: 'platform.user.update',
    scopeType: 'platform',
    description: 'Update platform user profile fields',
  },
  {
    id: 'perm-platform-user-role-assign',
    name: 'platform.user.role.assign',
    scopeType: 'platform',
    description: 'Assign platform roles to users',
  },
  {
    id: 'perm-platform-user-workspace-assign',
    name: 'platform.user.workspace.assign',
    scopeType: 'platform',
    description: 'Assign users to workspaces from the platform console',
  },
  {
    id: 'perm-platform-role-read',
    name: 'platform.role.read',
    scopeType: 'platform',
    description: 'Read platform role catalog and permission assignments',
  },
  {
    id: 'perm-platform-role-create',
    name: 'platform.role.create',
    scopeType: 'platform',
    description: 'Create platform roles',
  },
  {
    id: 'perm-platform-role-update',
    name: 'platform.role.update',
    scopeType: 'platform',
    description: 'Update platform roles',
  },
  {
    id: 'perm-platform-role-delete',
    name: 'platform.role.delete',
    scopeType: 'platform',
    description: 'Delete platform roles',
  },
  {
    id: 'perm-platform-workspace-read',
    name: 'platform.workspace.read',
    scopeType: 'platform',
    description: 'Read workspace governance data from the platform console',
  },
  {
    id: 'perm-workspace-create',
    name: 'workspace.create',
    scopeType: 'platform',
    description: 'Create a new workspace',
  },
  {
    id: 'perm-platform-workspace-member-manage',
    name: 'platform.workspace.member.manage',
    scopeType: 'platform',
    description: 'Manage workspace members from the platform console',
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
  {
    id: 'perm-platform-audit-read',
    name: 'platform.audit.read',
    scopeType: 'platform',
    description: 'Read platform audit logs',
  },
  {
    id: 'perm-platform-diagnostics-read',
    name: 'platform.diagnostics.read',
    scopeType: 'platform',
    description: 'Read platform diagnostics data',
  },
  {
    id: 'perm-platform-system-task-read',
    name: 'platform.system_task.read',
    scopeType: 'platform',
    description: 'Read platform system task status',
  },
  {
    id: 'perm-platform-system-task-manage',
    name: 'platform.system_task.manage',
    scopeType: 'platform',
    description: 'Manage platform system tasks',
  },
];

const defaultPlatformRoles = [
  {
    id: 'role-platform-admin',
    name: 'platform_admin',
    displayName: '平台管理员',
    scopeType: 'platform',
    scopeId: '',
    description: '管理平台级菜单、跨空间治理与高风险平台动作。',
    isSystem: true,
    isActive: true,
    createdBy: null,
  },
  {
    id: 'role-platform-iam-admin',
    name: 'platform_iam_admin',
    displayName: '平台权限管理员',
    scopeType: 'platform',
    scopeId: '',
    description: '负责平台用户目录、角色目录与平台角色分配。',
    isSystem: true,
    isActive: true,
    createdBy: null,
  },
  {
    id: 'role-platform-workspace-admin',
    name: 'platform_workspace_admin',
    displayName: '平台空间管理员',
    scopeType: 'platform',
    scopeId: '',
    description: '负责工作空间列表、创建、成员治理、系统任务与用户分配。',
    isSystem: true,
    isActive: true,
    createdBy: null,
  },
  {
    id: 'role-platform-auditor',
    name: 'platform_auditor',
    displayName: '平台审计员',
    scopeType: 'platform',
    scopeId: '',
    description: '负责只读查看平台目录、工作空间与观测数据。',
    isSystem: true,
    isActive: true,
    createdBy: null,
  },
  {
    id: 'role-support-readonly',
    name: 'support_readonly',
    displayName: '支持只读',
    scopeType: 'platform',
    scopeId: '',
    description: '面向支持与运营排障，只读查看平台目录、空间、审计与诊断。',
    isSystem: true,
    isActive: true,
    createdBy: null,
  },
  {
    id: 'role-support-impersonator',
    name: 'support_impersonator',
    displayName: '支持代理员',
    scopeType: 'platform',
    scopeId: '',
    description: '在严格审计下发起身份模拟，并保留只读排障能力。',
    isSystem: true,
    isActive: true,
    createdBy: null,
  },
];

const defaultRolePermissions = [
  ...defaultPlatformPermissions.map((permission) => ({
    id: `rp-platform-admin-${permission.id}`,
    roleId: 'role-platform-admin',
    permissionId: permission.id,
  })),
  ...defaultPlatformPermissions
    .filter((permission) =>
      [
        'platform.user.read',
        'platform.user.create',
        'platform.user.update',
        'platform.user.role.assign',
        'platform.user.workspace.assign',
        'platform.role.read',
        'platform.role.create',
        'platform.role.update',
        'platform.role.delete',
      ].includes(permission.name),
    )
    .map((permission) => ({
      id: `rp-platform-iam-admin-${permission.id}`,
      roleId: 'role-platform-iam-admin',
      permissionId: permission.id,
    })),
  ...defaultPlatformPermissions
    .filter((permission) =>
      [
        'platform.workspace.read',
        'workspace.create',
        'platform.workspace.member.manage',
        'platform.user.workspace.assign',
        'platform.system_task.read',
        'platform.system_task.manage',
      ].includes(permission.name),
    )
    .map((permission) => ({
      id: `rp-platform-workspace-admin-${permission.id}`,
      roleId: 'role-platform-workspace-admin',
      permissionId: permission.id,
    })),
  ...defaultPlatformPermissions
    .filter((permission) =>
      [
        'platform.user.read',
        'platform.role.read',
        'platform.workspace.read',
        'platform.audit.read',
        'platform.diagnostics.read',
        'platform.system_task.read',
      ].includes(permission.name),
    )
    .map((permission) => ({
      id: `rp-platform-auditor-${permission.id}`,
      roleId: 'role-platform-auditor',
      permissionId: permission.id,
    })),
  ...defaultPlatformPermissions
    .filter((permission) =>
      [
        'platform.user.read',
        'platform.role.read',
        'platform.workspace.read',
        'platform.audit.read',
        'platform.diagnostics.read',
        'platform.system_task.read',
      ].includes(permission.name),
    )
    .map((permission) => ({
      id: `rp-support-readonly-${permission.id}`,
      roleId: 'role-support-readonly',
      permissionId: permission.id,
    })),
  ...defaultPlatformPermissions
    .filter((permission) =>
      [
        'platform.user.read',
        'platform.role.read',
        'platform.workspace.read',
        'platform.audit.read',
        'platform.diagnostics.read',
        'platform.system_task.read',
        'impersonation.start',
      ].includes(permission.name),
    )
    .map((permission) => ({
      id: `rp-support-impersonator-${permission.id}`,
      roleId: 'role-support-impersonator',
      permissionId: permission.id,
    })),
];

const defaultPlatformBindings = [
  {
    id: 'binding-platform-admin',
    principalType: 'user',
    principalId: 'user-1',
    roleId: 'role-platform-admin',
    scopeType: 'platform',
    scopeId: '',
  },
];

export const resetPlatformApiTestEnv = () => {
  [
    mockValidateSession,
    mockGetSessionTokenFromRequest,
    mockBuildAuthorizationActorFromValidatedSession,
    mockBuildAuthorizationContextFromRequest,
    mockAssertAuthorizedWithAudit,
    mockRecordAuditEvent,
    mockSearchAuditEvents,
    mockListUsers,
    mockListUsersBy,
    mockGetUser,
    mockUpdateUser,
    mockRegisterLocalUser,
    mockLogout,
    mockListWorkspaces,
    mockGetWorkspace,
    mockListWorkspaceMembers,
    mockGetWorkspaceMember,
    mockListKnowledgeBases,
    mockGetKnowledgeBase,
    mockListConnectors,
    mockListSkills,
    mockListWorkspacesForUser,
    mockCreateWorkspace,
    mockAddWorkspaceMember,
    mockUpdateWorkspaceMember,
    mockRemoveWorkspaceMember,
    mockListRoles,
    mockGetRole,
    mockCreateRole,
    mockUpdateRole,
    mockDeleteRole,
    mockRoleTransaction,
    mockRoleCommit,
    mockRoleRollback,
    mockListPermissions,
    mockCreatePermissions,
    mockListRolePermissions,
    mockCreateRolePermissions,
    mockDeleteRolePermissions,
    mockListPrincipalRoleBindings,
    mockCreatePrincipalRoleBinding,
    mockDeletePrincipalRoleBindingsByScope,
    mockCountApiHistory,
    mockListApiHistoryWithPagination,
    mockListScheduleJobs,
    mockGetScheduleJob,
    mockListScheduleRuns,
    mockListScheduleRunsByJobIds,
    mockGetDashboard,
    mockSetDashboardSchedule,
    mockSyncDashboardRefreshJob,
    mockRunJobNow,
    mockGetKbSnapshot,
  ].forEach((mockFn) => mockFn.mockReset());
  mockGetSessionTokenFromRequest.mockReturnValue('session-token');
  mockValidateSession.mockResolvedValue(platformAdminSession);
  mockBuildAuthorizationActorFromValidatedSession.mockReturnValue(
    platformAdminActor,
  );
  mockBuildAuthorizationContextFromRequest.mockReturnValue({
    requestId: 'req-1',
  });
  mockAssertAuthorizedWithAudit.mockResolvedValue(undefined);
  mockRecordAuditEvent.mockResolvedValue(undefined);
  mockListUsers.mockResolvedValue([]);
  mockListUsersBy.mockResolvedValue([]);
  mockGetUser.mockResolvedValue(null);
  mockUpdateUser.mockResolvedValue(undefined);
  mockRegisterLocalUser.mockResolvedValue({
    sessionToken: 'created-user-session',
    user: {
      id: 'user-created',
      email: 'created@example.com',
      displayName: 'Created User',
      status: 'active',
      isPlatformAdmin: false,
      defaultWorkspaceId: null,
    },
  });
  mockLogout.mockResolvedValue(undefined);
  mockListWorkspaces.mockResolvedValue([]);
  mockGetWorkspace.mockResolvedValue(null);
  mockListWorkspaceMembers.mockResolvedValue([]);
  mockGetWorkspaceMember.mockResolvedValue(null);
  mockListKnowledgeBases.mockResolvedValue([]);
  mockGetKnowledgeBase.mockResolvedValue(null);
  mockListConnectors.mockResolvedValue([]);
  mockListSkills.mockResolvedValue([]);
  mockListWorkspacesForUser.mockResolvedValue([]);
  mockCreateWorkspace.mockResolvedValue(null);
  mockAddWorkspaceMember.mockResolvedValue(null);
  mockUpdateWorkspaceMember.mockResolvedValue(null);
  mockRemoveWorkspaceMember.mockResolvedValue(undefined);
  mockListRoles.mockResolvedValue(defaultPlatformRoles);
  mockGetRole.mockResolvedValue(defaultPlatformRoles[0]);
  mockCreateRole.mockImplementation(async (payload: any) => payload);
  mockUpdateRole.mockImplementation(async (_id: string, payload: any) => ({
    ...defaultPlatformRoles[0],
    ...payload,
  }));
  mockDeleteRole.mockResolvedValue(1);
  mockRoleTransaction.mockResolvedValue({ id: 'tx-platform-role' });
  mockRoleCommit.mockResolvedValue(undefined);
  mockRoleRollback.mockResolvedValue(undefined);
  mockListPermissions.mockResolvedValue(defaultPlatformPermissions);
  mockCreatePermissions.mockImplementation(async (payload: any[]) => payload);
  mockListRolePermissions.mockResolvedValue(defaultRolePermissions);
  mockCreateRolePermissions.mockImplementation(
    async (payload: any[]) => payload,
  );
  mockDeleteRolePermissions.mockResolvedValue(1);
  mockListPrincipalRoleBindings.mockResolvedValue(defaultPlatformBindings);
  mockCreatePrincipalRoleBinding.mockImplementation(
    async (payload: any) => payload,
  );
  mockDeletePrincipalRoleBindingsByScope.mockResolvedValue(1);
  mockSearchAuditEvents.mockResolvedValue([]);
  mockCountApiHistory.mockResolvedValue(0);
  mockListApiHistoryWithPagination.mockResolvedValue([]);
  mockListScheduleJobs.mockResolvedValue([]);
  mockGetScheduleJob.mockResolvedValue(null);
  mockListScheduleRuns.mockResolvedValue([]);
  mockListScheduleRunsByJobIds.mockResolvedValue([]);
  mockGetDashboard.mockResolvedValue(null);
  mockSetDashboardSchedule.mockResolvedValue(null);
  mockSyncDashboardRefreshJob.mockResolvedValue(null);
  mockRunJobNow.mockResolvedValue(undefined);
  mockGetKbSnapshot.mockResolvedValue(null);
};
