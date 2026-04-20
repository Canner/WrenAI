const originalBindingMode = process.env.WREN_AUTHORIZATION_BINDING_MODE;

export const restoreModelControllerBindingMode = () => {
  if (originalBindingMode === undefined) {
    delete process.env.WREN_AUTHORIZATION_BINDING_MODE;
  } else {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = originalBindingMode;
  }
};

export const createContext = () =>
  ({
    runtimeScope: {
      project: { id: 1 },
      workspace: { id: 'workspace-1' },
      knowledgeBase: { id: 'kb-1', defaultKbSnapshotId: 'snapshot-1' },
      kbSnapshot: { id: 'snapshot-1' },
      deployment: { hash: 'deploy-1', manifest: { models: [] } },
      deployHash: 'deploy-1',
      userId: 'user-1',
    },
    authorizationActor: {
      principalType: 'user',
      principalId: 'user-1',
      workspaceId: 'workspace-1',
      workspaceMemberId: 'member-1',
      workspaceRoleKeys: ['owner'],
      permissionScopes: ['workspace:*'],
      isPlatformAdmin: false,
      platformRoleKeys: [],
    },
    auditEventRepository: {
      createOne: jest.fn(),
    },
    telemetry: { sendEvent: jest.fn() },
    modelRepository: {
      findAllByIds: jest.fn(),
      createOne: jest.fn(),
    },
    modelColumnRepository: {
      findOneBy: jest.fn(),
      findColumnsByModelIds: jest.fn(),
    },
    modelNestedColumnRepository: {
      findAllBy: jest.fn(),
    },
    relationRepository: {
      findOneBy: jest.fn(),
      findRelationsBy: jest.fn(),
    },
    viewRepository: {
      findOneBy: jest.fn(),
    },
    modelService: {
      createRelation: jest.fn(),
      createRelationByRuntimeIdentity: jest.fn(),
      updateRelation: jest.fn(),
      updateRelationByRuntimeIdentity: jest.fn(),
      deleteRelation: jest.fn(),
      deleteRelationByRuntimeIdentity: jest.fn(),
      createCalculatedFieldScoped: jest.fn(),
      createCalculatedFieldByRuntimeIdentity: jest.fn(),
      updateCalculatedFieldScoped: jest.fn(),
      updateCalculatedFieldByRuntimeIdentity: jest.fn(),
      validateCalculatedFieldNaming: jest.fn(),
      listModelsByRuntimeIdentity: jest.fn(),
      getModelsByRuntimeIdentity: jest.fn(),
      getModelByRuntimeIdentity: jest.fn(),
      getModelsScoped: jest.fn(),
      getModelScoped: jest.fn(),
      getColumnScoped: jest.fn(),
      getColumnByRuntimeIdentity: jest.fn(),
      getViewScoped: jest.fn(),
      getViewByRuntimeIdentity: jest.fn(),
      getViewsScoped: jest.fn(),
      getViewsByRuntimeIdentity: jest.fn(),
      getRelationScoped: jest.fn(),
      getRelationByRuntimeIdentity: jest.fn(),
      validateViewNameScoped: jest.fn().mockResolvedValue({ valid: true }),
      validateViewNameByRuntimeIdentity: jest
        .fn()
        .mockResolvedValue({ valid: true }),
    },
    queryService: {
      preview: jest.fn(),
    },
    projectService: {
      getProjectById: jest.fn(),
    },
    runtimeScopeResolver: {
      resolveRuntimeScopeId: jest.fn(),
    },
    deployService: {
      getDeploymentByRuntimeIdentity: jest.fn(),
      getLastDeployment: jest.fn(),
      createMDLHashByRuntimeIdentity: jest.fn(),
    },
    knowledgeBaseRepository: {
      findOneBy: jest.fn(),
    },
    kbSnapshotRepository: {
      findOneBy: jest.fn(),
    },
  }) as any;
