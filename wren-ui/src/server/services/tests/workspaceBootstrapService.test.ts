import { SampleDatasetName } from '@server/data';
import { WorkspaceBootstrapService } from '../workspaceBootstrapService';

const createKnowledgeBase = (overrides: Record<string, any> = {}) => ({
  id: overrides.id || 'kb-1',
  workspaceId: overrides.workspaceId || 'workspace-default',
  slug: overrides.slug || 'hr',
  name: overrides.name || 'HR',
  kind: overrides.kind || 'system_sample',
  description: overrides.description || 'HR 系统样例知识库',
  defaultKbSnapshotId: overrides.defaultKbSnapshotId ?? null,
  primaryConnectorId: overrides.primaryConnectorId ?? null,
  language: overrides.language ?? null,
  sampleDataset: overrides.sampleDataset || 'HR',
  createdBy: overrides.createdBy ?? null,
  archivedAt: overrides.archivedAt ?? null,
});

describe('WorkspaceBootstrapService', () => {
  let workspaceRepository: any;
  let knowledgeBaseRepository: any;
  let kbSnapshotRepository: any;
  let projectRepository: any;
  let projectService: any;
  let modelService: any;
  let modelRepository: any;
  let modelColumnRepository: any;
  let modelNestedColumnRepository: any;
  let relationRepository: any;
  let deployService: any;
  let deployLogRepository: any;
  let mdlService: any;
  let dashboardService: any;
  let wrenEngineAdaptor: any;
  let service: WorkspaceBootstrapService;

  beforeEach(() => {
    workspaceRepository = {
      findOneBy: jest.fn(),
      createOne: jest.fn(),
    };
    knowledgeBaseRepository = {
      findOneBy: jest.fn(),
      createOne: jest.fn(),
      updateOne: jest.fn(),
    };
    kbSnapshotRepository = {
      findOneBy: jest.fn(),
      createOne: jest.fn(),
      updateOne: jest.fn(),
    };
    projectRepository = {
      findOneBy: jest.fn(),
      updateOne: jest.fn(),
    };
    projectService = {
      createProject: jest.fn(),
      getProjectConnectionTables: jest.fn(),
    };
    modelService = {
      deleteAllViewsByProjectId: jest.fn(),
      deleteAllModelsByProjectId: jest.fn(),
      updatePrimaryKeys: jest.fn(),
      batchUpdateModelProperties: jest.fn(),
      batchUpdateColumnProperties: jest.fn(),
      saveRelations: jest.fn(),
    };
    modelRepository = {
      createMany: jest.fn(),
      findAllBy: jest.fn(),
      updateOne: jest.fn(),
    };
    modelColumnRepository = {
      createMany: jest.fn(),
    };
    modelNestedColumnRepository = {
      createMany: jest.fn(),
    };
    relationRepository = {
      findAllBy: jest.fn(),
      updateOne: jest.fn(),
    };
    deployService = {
      getLastDeployment: jest.fn(),
      getDeploymentByRuntimeIdentity: jest.fn(),
      getLastDeploymentByRuntimeIdentity: jest.fn(),
      deploy: jest.fn(),
    };
    deployLogRepository = {
      updateOne: jest.fn(),
    };
    mdlService = {
      makeCurrentModelMDL: jest.fn(),
    };
    dashboardService = {
      initDashboard: jest.fn(),
    };
    wrenEngineAdaptor = {
      prepareDuckDB: jest.fn(),
      listTables: jest.fn(),
      patchConfig: jest.fn(),
    };

    service = new WorkspaceBootstrapService({
      workspaceRepository,
      knowledgeBaseRepository,
      kbSnapshotRepository,
      projectRepository,
      projectService,
      modelService,
      modelRepository,
      modelColumnRepository,
      modelNestedColumnRepository,
      relationRepository,
      deployService,
      deployLogRepository,
      mdlService,
      dashboardService,
      wrenEngineAdaptor,
    });
  });

  it('skips runtime seeding when metadata is ensured inside a transaction', async () => {
    const workspace = {
      id: 'workspace-default',
      slug: 'system-samples',
      name: '系统样例空间',
      kind: 'default',
      status: 'active',
    };
    const tx = { id: 'tx-1' };
    workspaceRepository.findOneBy.mockResolvedValue(workspace);
    knowledgeBaseRepository.findOneBy.mockImplementation(async (filter: any) =>
      createKnowledgeBase({
        id: `kb-${filter.slug || filter.sampleDataset}`,
        slug: filter.slug || String(filter.sampleDataset).toLowerCase(),
        name: filter.slug
          ? String(filter.slug).toUpperCase()
          : filter.sampleDataset,
        sampleDataset:
          filter.sampleDataset || String(filter.slug).toUpperCase(),
      }),
    );

    const result = await service.ensureDefaultWorkspaceWithSamples({
      tx: tx as any,
    });

    expect(result).toBe(workspace);
    expect(
      deployService.getLastDeploymentByRuntimeIdentity,
    ).not.toHaveBeenCalled();
    expect(projectService.createProject).not.toHaveBeenCalled();
  });

  it('eagerly seeds only the primary sample runtime and warms the rest in background', async () => {
    const workspace = {
      id: 'workspace-default',
      slug: 'system-samples',
      name: '系统样例空间',
      kind: 'default',
      status: 'active',
    };
    const knowledgeBases = [
      createKnowledgeBase({
        id: 'kb-hr',
        slug: 'hr',
        name: 'HR',
        description: 'HR 系统样例知识库',
        sampleDataset: 'HR',
      }),
      createKnowledgeBase({
        id: 'kb-ecommerce',
        slug: 'ecommerce',
        name: 'ECOMMERCE',
        description: 'ECOMMERCE 系统样例知识库',
        sampleDataset: 'ECOMMERCE',
      }),
      createKnowledgeBase({
        id: 'kb-music',
        slug: 'music',
        name: 'MUSIC',
        description: 'MUSIC 系统样例知识库',
        sampleDataset: 'MUSIC',
      }),
      createKnowledgeBase({
        id: 'kb-nba',
        slug: 'nba',
        name: 'NBA',
        description: 'NBA 系统样例知识库',
        sampleDataset: 'NBA',
      }),
    ];

    workspaceRepository.findOneBy.mockResolvedValue(workspace);
    knowledgeBaseRepository.updateOne.mockImplementation(
      async (id: string, payload: Record<string, any>) => ({
        ...(knowledgeBases.find((knowledgeBase) => knowledgeBase.id === id) || {
          id,
        }),
        ...payload,
      }),
    );
    knowledgeBaseRepository.findOneBy.mockImplementation(
      async (filter: any) => {
        const matchedKnowledgeBase = knowledgeBases.find(
          (knowledgeBase) =>
            knowledgeBase.slug === filter.slug ||
            knowledgeBase.sampleDataset === filter.sampleDataset,
        );

        return (
          matchedKnowledgeBase ||
          createKnowledgeBase({
            id: `kb-${filter.slug || String(filter.sampleDataset).toLowerCase()}`,
            slug: filter.slug || String(filter.sampleDataset).toLowerCase(),
            name: filter.sampleDataset || String(filter.slug).toUpperCase(),
            sampleDataset:
              filter.sampleDataset || String(filter.slug).toUpperCase(),
          })
        );
      },
    );

    const ensureSystemSampleRuntimeSpy = jest
      .spyOn(service as any, 'ensureSystemSampleRuntime')
      .mockResolvedValue(undefined);
    const warmSystemSampleRuntimesInBackgroundSpy = jest
      .spyOn(service as any, 'warmSystemSampleRuntimesInBackground')
      .mockImplementation(() => undefined);

    await service.ensureDefaultWorkspaceWithSamples({
      runtimeSeedMode: 'default_only',
    });

    expect(ensureSystemSampleRuntimeSpy).toHaveBeenCalledTimes(1);
    expect(ensureSystemSampleRuntimeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'kb-ecommerce',
        sampleDataset: 'ECOMMERCE',
      }),
    );
    expect(warmSystemSampleRuntimesInBackgroundSpy).toHaveBeenCalledWith(
      workspace.id,
      expect.arrayContaining(knowledgeBases),
      'kb-ecommerce',
    );
  });

  it('can eagerly seed a requested sample runtime without booting the rest', async () => {
    const workspace = {
      id: 'workspace-default',
      slug: 'system-samples',
      name: '系统样例空间',
      kind: 'default',
      status: 'active',
    };
    const knowledgeBases = [
      createKnowledgeBase({
        id: 'kb-hr',
        slug: 'hr',
        name: 'HR',
        description: 'HR 系统样例知识库',
        sampleDataset: 'HR',
      }),
      createKnowledgeBase({
        id: 'kb-ecommerce',
        slug: 'ecommerce',
        name: 'ECOMMERCE',
        description: 'ECOMMERCE 系统样例知识库',
        sampleDataset: 'ECOMMERCE',
      }),
      createKnowledgeBase({
        id: 'kb-music',
        slug: 'music',
        name: 'MUSIC',
        description: 'MUSIC 系统样例知识库',
        sampleDataset: 'MUSIC',
      }),
      createKnowledgeBase({
        id: 'kb-nba',
        slug: 'nba',
        name: 'NBA',
        description: 'NBA 系统样例知识库',
        sampleDataset: 'NBA',
      }),
    ];

    workspaceRepository.findOneBy.mockResolvedValue(workspace);
    knowledgeBaseRepository.findOneBy.mockImplementation(
      async (filter: any) => {
        const matchedKnowledgeBase = knowledgeBases.find(
          (knowledgeBase) =>
            knowledgeBase.slug === filter.slug ||
            knowledgeBase.sampleDataset === filter.sampleDataset,
        );

        return (
          matchedKnowledgeBase ||
          createKnowledgeBase({
            id: `kb-${filter.slug || String(filter.sampleDataset).toLowerCase()}`,
            slug: filter.slug || String(filter.sampleDataset).toLowerCase(),
            name: filter.sampleDataset || String(filter.slug).toUpperCase(),
            sampleDataset:
              filter.sampleDataset || String(filter.slug).toUpperCase(),
          })
        );
      },
    );

    const ensureSystemSampleRuntimeSpy = jest
      .spyOn(service as any, 'ensureSystemSampleRuntime')
      .mockResolvedValue(undefined);

    const result = await service.ensureDefaultWorkspaceSampleRuntime({
      sampleDataset: SampleDatasetName.HR,
    });

    expect(ensureSystemSampleRuntimeSpy).toHaveBeenCalledTimes(1);
    expect(ensureSystemSampleRuntimeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'kb-hr',
        sampleDataset: 'HR',
      }),
    );
    expect(result).toEqual({
      workspace,
      knowledgeBase: expect.objectContaining({
        id: 'kb-hr',
        sampleDataset: 'HR',
      }),
    });
  });

  it('can schedule all sample runtimes in background without blocking the caller', async () => {
    const workspace = {
      id: 'workspace-default',
      slug: 'system-samples',
      name: '系统样例空间',
      kind: 'default',
      status: 'active',
    };
    const knowledgeBases = [
      createKnowledgeBase({
        id: 'kb-hr',
        slug: 'hr',
        name: 'HR',
        description: 'HR 系统样例知识库',
        sampleDataset: 'HR',
      }),
      createKnowledgeBase({
        id: 'kb-ecommerce',
        slug: 'ecommerce',
        name: 'ECOMMERCE',
        description: 'ECOMMERCE 系统样例知识库',
        sampleDataset: 'ECOMMERCE',
      }),
    ];

    workspaceRepository.findOneBy.mockResolvedValue(workspace);
    knowledgeBaseRepository.findOneBy.mockImplementation(
      async (filter: any) => {
        const matchedKnowledgeBase = knowledgeBases.find(
          (knowledgeBase) =>
            knowledgeBase.slug === filter.slug ||
            knowledgeBase.sampleDataset === filter.sampleDataset,
        );

        return (
          matchedKnowledgeBase ||
          createKnowledgeBase({
            id: `kb-${filter.slug || String(filter.sampleDataset).toLowerCase()}`,
            slug: filter.slug || String(filter.sampleDataset).toLowerCase(),
            name: filter.sampleDataset || String(filter.slug).toUpperCase(),
            description: `${
              filter.sampleDataset || String(filter.slug).toUpperCase()
            } 系统样例知识库`,
            sampleDataset:
              filter.sampleDataset || String(filter.slug).toUpperCase(),
          })
        );
      },
    );

    const ensureSystemSampleRuntimeSpy = jest
      .spyOn(service as any, 'ensureSystemSampleRuntime')
      .mockResolvedValue(undefined);
    const warmSystemSampleRuntimesInBackgroundSpy = jest
      .spyOn(service as any, 'warmSystemSampleRuntimesInBackground')
      .mockImplementation(() => undefined);

    await service.ensureDefaultWorkspaceWithSamples({
      runtimeSeedMode: 'background_all',
    });

    expect(ensureSystemSampleRuntimeSpy).not.toHaveBeenCalled();
    expect(warmSystemSampleRuntimesInBackgroundSpy).toHaveBeenCalledWith(
      workspace.id,
      expect.arrayContaining(knowledgeBases),
      null,
    );
  });

  it('hydrates snapshot and canonical runtime bindings from an existing deployment', async () => {
    const knowledgeBase = createKnowledgeBase({
      id: 'kb-hr',
      workspaceId: 'workspace-default',
      slug: 'hr',
      name: 'HR',
      sampleDataset: 'HR',
    });
    const deployment = {
      id: 7,
      projectId: 99,
      hash: 'deploy-hash-1',
      kbSnapshotId: null,
      manifest: {},
      status: 'SUCCESS',
      error: null,
    };
    const snapshot = {
      id: 'snapshot-1',
      knowledgeBaseId: knowledgeBase.id,
      snapshotKey: 'system-sample-default',
      displayName: 'HR 默认快照',
      deployHash: deployment.hash,
      status: 'active',
    };
    const model = {
      id: 1,
      projectId: deployment.projectId,
      workspaceId: null,
      knowledgeBaseId: null,
      kbSnapshotId: null,
      deployHash: null,
    };
    const relation = {
      id: 11,
      projectId: deployment.projectId,
      workspaceId: null,
      knowledgeBaseId: null,
      kbSnapshotId: null,
      deployHash: null,
    };

    kbSnapshotRepository.findOneBy.mockResolvedValue(null);
    deployService.getLastDeploymentByRuntimeIdentity.mockResolvedValue(
      deployment,
    );
    projectRepository.findOneBy.mockResolvedValue({
      id: deployment.projectId,
      displayName: '[system-sample] hr HR',
      sampleDataset: 'HR',
      type: 'DUCKDB',
    });
    kbSnapshotRepository.createOne.mockResolvedValue(snapshot);
    modelRepository.findAllBy.mockResolvedValue([model]);
    modelRepository.updateOne.mockResolvedValue({ ...model, ...snapshot });
    relationRepository.findAllBy.mockResolvedValue([relation]);
    relationRepository.updateOne.mockResolvedValue({
      ...relation,
      ...snapshot,
    });
    knowledgeBaseRepository.updateOne.mockResolvedValue({
      ...knowledgeBase,
      defaultKbSnapshotId: snapshot.id,
    });
    dashboardService.initDashboard.mockResolvedValue({ id: 1 });

    await (service as any).ensureSystemSampleRuntime(knowledgeBase);

    expect(kbSnapshotRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeBaseId: knowledgeBase.id,
        snapshotKey: 'system-sample-default',
        deployHash: deployment.hash,
      }),
    );
    expect(deployLogRepository.updateOne).toHaveBeenCalledWith(
      deployment.id,
      expect.objectContaining({ kbSnapshotId: snapshot.id }),
    );
    expect(knowledgeBaseRepository.updateOne).toHaveBeenCalledWith(
      knowledgeBase.id,
      expect.objectContaining({
        defaultKbSnapshotId: snapshot.id,
        primaryConnectorId: null,
      }),
    );
    expect(modelRepository.updateOne).toHaveBeenCalledWith(
      model.id,
      expect.objectContaining({
        workspaceId: knowledgeBase.workspaceId,
        knowledgeBaseId: knowledgeBase.id,
        kbSnapshotId: snapshot.id,
        deployHash: deployment.hash,
      }),
    );
    expect(relationRepository.updateOne).toHaveBeenCalledWith(
      relation.id,
      expect.objectContaining({
        workspaceId: knowledgeBase.workspaceId,
        knowledgeBaseId: knowledgeBase.id,
        kbSnapshotId: snapshot.id,
        deployHash: deployment.hash,
      }),
    );
    expect(dashboardService.initDashboard).toHaveBeenCalledWith(
      deployment.projectId,
      expect.objectContaining({
        knowledgeBaseId: knowledgeBase.id,
        kbSnapshotId: snapshot.id,
        deployHash: deployment.hash,
      }),
    );
  });

  it('seeds a sample deployment when no runtime exists yet', async () => {
    const knowledgeBase = createKnowledgeBase({
      id: 'kb-hr',
      workspaceId: 'workspace-default',
      slug: 'hr',
      name: 'HR',
      sampleDataset: 'HR',
    });
    const project = {
      id: 42,
      displayName: '[system-sample] hr HR',
      sampleDataset: null,
      type: 'DUCKDB',
    };
    const deployment = {
      id: 8,
      projectId: project.id,
      hash: 'deploy-hash-2',
      kbSnapshotId: null,
      manifest: {},
      status: 'SUCCESS',
      error: null,
    };
    const snapshot = {
      id: 'snapshot-2',
      knowledgeBaseId: knowledgeBase.id,
      snapshotKey: 'system-sample-default',
      displayName: 'HR 默认快照',
      deployHash: deployment.hash,
      status: 'active',
    };

    jest
      .spyOn(service as any, 'prepareDuckDBEnvironment')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'createModelsAndColumns').mockResolvedValue({
      models: [],
      columns: [],
    });
    jest.spyOn(service as any, 'buildRelationInput').mockReturnValue([]);

    kbSnapshotRepository.findOneBy.mockResolvedValue(null);
    deployService.getLastDeploymentByRuntimeIdentity
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(deployment);
    deployService.getLastDeployment.mockResolvedValue(deployment);
    projectRepository.findOneBy.mockResolvedValue(null);
    projectService.createProject.mockResolvedValue(project);
    projectService.getProjectConnectionTables.mockResolvedValue([]);
    projectRepository.updateOne.mockResolvedValue({
      ...project,
      sampleDataset: 'HR',
    });
    mdlService.makeCurrentModelMDL.mockResolvedValue({ manifest: {} });
    deployService.deploy.mockResolvedValue({ status: 'SUCCESS' });
    kbSnapshotRepository.createOne.mockResolvedValue(snapshot);
    modelRepository.findAllBy.mockResolvedValue([]);
    relationRepository.findAllBy.mockResolvedValue([]);
    knowledgeBaseRepository.updateOne.mockResolvedValue({
      ...knowledgeBase,
      defaultKbSnapshotId: snapshot.id,
    });
    dashboardService.initDashboard.mockResolvedValue({ id: 1 });

    await (service as any).ensureSystemSampleRuntime(knowledgeBase);

    expect(projectService.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: '[system-sample] hr HR',
        type: 'DUCKDB',
      }),
    );
    expect(mdlService.makeCurrentModelMDL).toHaveBeenCalledWith(project.id);
    expect(deployService.deploy).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        projectId: project.id,
        workspaceId: knowledgeBase.workspaceId,
        knowledgeBaseId: knowledgeBase.id,
      }),
      false,
    );
    expect(deployService.getLastDeployment).toHaveBeenCalledWith(project.id);
    expect(kbSnapshotRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        knowledgeBaseId: knowledgeBase.id,
        deployHash: deployment.hash,
      }),
    );
  });
});
