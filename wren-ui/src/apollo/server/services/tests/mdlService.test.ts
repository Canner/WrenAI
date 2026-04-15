import { MDLService } from '../mdlService';

describe('MDLService', () => {
  it('builds MDL by runtime identity using deploy hash when the project bridge is absent', async () => {
    const modelRepository = {
      findAllByRuntimeIdentity: jest.fn().mockResolvedValue([]),
    };
    const service = new MDLService({
      projectRepository: {
        findOneBy: jest.fn().mockResolvedValue({
          id: 42,
          displayName: 'Project',
          catalog: 'wrenai',
          schema: 'public',
          type: 'POSTGRES',
        }),
      } as any,
      deployLogRepository: {
        findOneBy: jest.fn().mockResolvedValue({
          projectId: 42,
          hash: 'deploy-1',
        }),
        findLastRuntimeDeployLog: jest.fn(),
      } as any,
      modelRepository: modelRepository as any,
      modelColumnRepository: {
        findColumnsByModelIds: jest.fn().mockResolvedValue([]),
      } as any,
      modelNestedColumnRepository: {
        findNestedColumnsByModelIds: jest.fn().mockResolvedValue([]),
      } as any,
      relationRepository: {
        findRelationInfoBy: jest.fn().mockResolvedValue([]),
      } as any,
      viewRepository: {
        findAllByRuntimeIdentity: jest.fn().mockResolvedValue([]),
      } as any,
    } as any);

    const result = await service.makeCurrentModelMDLByRuntimeIdentity({
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
    });

    expect(result.project.id).toBe(42);
    expect(result.manifest).toBeDefined();
    expect(modelRepository.findAllByRuntimeIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      }),
    );
  });

  it('builds MDL by runtime identity using the matched model project bridge before deploy history fallback', async () => {
    const deployLogRepository = {
      findOneBy: jest.fn(),
      findLastRuntimeDeployLog: jest.fn(),
    };
    const service = new MDLService({
      projectRepository: {
        findOneBy: jest.fn().mockResolvedValue({
          id: 52,
          displayName: 'Project',
          catalog: 'wrenai',
          schema: 'public',
          type: 'POSTGRES',
        }),
      } as any,
      deployLogRepository: deployLogRepository as any,
      modelRepository: {
        findAllByRuntimeIdentity: jest.fn().mockResolvedValue([
          { id: 1, projectId: 52 },
          { id: 2, projectId: 52 },
        ]),
      } as any,
      modelColumnRepository: {
        findColumnsByModelIds: jest.fn().mockResolvedValue([]),
      } as any,
      modelNestedColumnRepository: {
        findNestedColumnsByModelIds: jest.fn().mockResolvedValue([]),
      } as any,
      relationRepository: {
        findRelationInfoBy: jest.fn().mockResolvedValue([]),
      } as any,
      viewRepository: {
        findAllByRuntimeIdentity: jest.fn().mockResolvedValue([]),
      } as any,
    } as any);

    const result = await service.makeCurrentModelMDLByRuntimeIdentity({
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: null,
    });

    expect(result.project.id).toBe(52);
    expect(deployLogRepository.findOneBy).not.toHaveBeenCalled();
  });

  it('prefers runtime-scoped model ownership over a stale runtimeIdentity.projectId when canonical runtime fields exist', async () => {
    const projectRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 52,
        displayName: 'Project',
        catalog: 'wrenai',
        schema: 'public',
        type: 'POSTGRES',
      }),
    };
    const service = new MDLService({
      projectRepository: projectRepository as any,
      deployLogRepository: {
        findOneBy: jest.fn(),
        findLastRuntimeDeployLog: jest.fn(),
      } as any,
      modelRepository: {
        findAllByRuntimeIdentity: jest.fn().mockResolvedValue([
          { id: 1, projectId: 52 },
          { id: 2, projectId: 52 },
        ]),
      } as any,
      modelColumnRepository: {
        findColumnsByModelIds: jest.fn().mockResolvedValue([]),
      } as any,
      modelNestedColumnRepository: {
        findNestedColumnsByModelIds: jest.fn().mockResolvedValue([]),
      } as any,
      relationRepository: {
        findRelationInfoBy: jest.fn().mockResolvedValue([]),
      } as any,
      viewRepository: {
        findAllByRuntimeIdentity: jest.fn().mockResolvedValue([]),
      } as any,
    } as any);

    const result = await service.makeCurrentModelMDLByRuntimeIdentity({
      projectId: 999,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: null,
    });

    expect(result.project.id).toBe(52);
    expect(projectRepository.findOneBy).toHaveBeenCalledWith({ id: 52 });
  });

  it('prefers deployment history over a stale runtimeIdentity.projectId when no scoped model bridge is available', async () => {
    const modelRepository = {
      findAllByRuntimeIdentity: jest.fn().mockResolvedValue([]),
    };
    const projectRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 77,
        displayName: 'Project',
        catalog: 'wrenai',
        schema: 'public',
        type: 'POSTGRES',
      }),
    };
    const deployLogRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        projectId: 77,
        hash: 'deploy-2',
      }),
      findLastRuntimeDeployLog: jest.fn(),
    };
    const service = new MDLService({
      projectRepository: projectRepository as any,
      deployLogRepository: deployLogRepository as any,
      modelRepository: modelRepository as any,
      modelColumnRepository: {
        findColumnsByModelIds: jest.fn().mockResolvedValue([]),
      } as any,
      modelNestedColumnRepository: {
        findNestedColumnsByModelIds: jest.fn().mockResolvedValue([]),
      } as any,
      relationRepository: {
        findRelationInfoBy: jest.fn().mockResolvedValue([]),
      } as any,
      viewRepository: {
        findAllByRuntimeIdentity: jest.fn().mockResolvedValue([]),
      } as any,
    } as any);

    const result = await service.makeCurrentModelMDLByRuntimeIdentity({
      projectId: 999,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-2',
    });

    expect(result.project.id).toBe(77);
    expect(projectRepository.findOneBy).toHaveBeenCalledWith({ id: 77 });
    expect(modelRepository.findAllByRuntimeIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-2',
      }),
    );
  });

  it('rebuilds MDL from deployment manifest metadata when the project row is gone', async () => {
    const projectRepository = {
      findOneBy: jest.fn().mockResolvedValue(null),
    };
    const deployLogRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        projectId: 77,
        hash: 'deploy-2',
        manifest: {
          catalog: 'analytics',
          schema: 'public',
          dataSource: 'POSTGRES',
        },
      }),
      findLastRuntimeDeployLog: jest.fn(),
    };
    const service = new MDLService({
      projectRepository: projectRepository as any,
      deployLogRepository: deployLogRepository as any,
      modelRepository: {
        findAllByRuntimeIdentity: jest.fn().mockResolvedValue([]),
      } as any,
      modelColumnRepository: {
        findColumnsByModelIds: jest.fn().mockResolvedValue([]),
      } as any,
      modelNestedColumnRepository: {
        findNestedColumnsByModelIds: jest.fn().mockResolvedValue([]),
      } as any,
      relationRepository: {
        findRelationInfoBy: jest.fn().mockResolvedValue([]),
      } as any,
      viewRepository: {
        findAllByRuntimeIdentity: jest.fn().mockResolvedValue([]),
      } as any,
    } as any);

    const result = await service.makeCurrentModelMDLByRuntimeIdentity({
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-2',
    });

    expect(result.project).toMatchObject({
      id: 77,
      catalog: 'analytics',
      schema: 'public',
      type: 'POSTGRES',
    });
    expect(projectRepository.findOneBy).toHaveBeenCalledWith({ id: 77 });
  });

  it('falls back to the latest canonical runtime deployment when deploy hash is absent and models are not yet persisted', async () => {
    const projectRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 88,
        displayName: 'Project',
        catalog: 'wrenai',
        schema: 'public',
        type: 'POSTGRES',
      }),
    };
    const deployLogRepository = {
      findOneBy: jest.fn(),
      findLastRuntimeDeployLog: jest.fn().mockResolvedValue({
        projectId: 88,
        hash: 'deploy-runtime-4',
      }),
    };
    const modelRepository = {
      findAllByRuntimeIdentity: jest.fn().mockResolvedValue([]),
    };
    const viewRepository = {
      findAllByRuntimeIdentity: jest.fn().mockResolvedValue([]),
    };
    const service = new MDLService({
      projectRepository: projectRepository as any,
      deployLogRepository: deployLogRepository as any,
      modelRepository: modelRepository as any,
      modelColumnRepository: {
        findColumnsByModelIds: jest.fn().mockResolvedValue([]),
      } as any,
      modelNestedColumnRepository: {
        findNestedColumnsByModelIds: jest.fn().mockResolvedValue([]),
      } as any,
      relationRepository: {
        findRelationInfoBy: jest.fn().mockResolvedValue([]),
      } as any,
      viewRepository: viewRepository as any,
    } as any);

    const result = await service.makeCurrentModelMDLByRuntimeIdentity({
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: null,
    });

    expect(result.project.id).toBe(88);
    expect(deployLogRepository.findLastRuntimeDeployLog).toHaveBeenCalledWith({
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: null,
      actorUserId: null,
    });
    expect(modelRepository.findAllByRuntimeIdentity).toHaveBeenCalledWith({
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-runtime-4',
      actorUserId: null,
    });
    expect(viewRepository.findAllByRuntimeIdentity).toHaveBeenCalledWith({
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-runtime-4',
      actorUserId: null,
    });
  });

  it('does not reuse runtimeIdentity.projectId as a canonical runtime fallback when scoped data is absent', async () => {
    const projectRepository = {
      findOneBy: jest.fn(),
    };
    const service = new MDLService({
      projectRepository: projectRepository as any,
      deployLogRepository: {
        findOneBy: jest.fn(),
        findLastRuntimeDeployLog: jest.fn().mockResolvedValue(null),
      } as any,
      modelRepository: {
        findAllByRuntimeIdentity: jest.fn().mockResolvedValue([]),
      } as any,
      modelColumnRepository: {
        findColumnsByModelIds: jest.fn().mockResolvedValue([]),
      } as any,
      modelNestedColumnRepository: {
        findNestedColumnsByModelIds: jest.fn().mockResolvedValue([]),
      } as any,
      relationRepository: {
        findRelationInfoBy: jest.fn().mockResolvedValue([]),
      } as any,
      viewRepository: {
        findAllByRuntimeIdentity: jest.fn().mockResolvedValue([]),
      } as any,
    } as any);

    await expect(
      service.makeCurrentModelMDLByRuntimeIdentity({
        projectId: 999,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: null,
      }),
    ).rejects.toThrow(
      'MDL runtime identity requires deploy metadata or resolvable project metadata',
    );
    expect(projectRepository.findOneBy).not.toHaveBeenCalled();
  });

  it('still supports legacy project-scoped runtime identities without canonical fields', async () => {
    const projectRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 91,
        displayName: 'Legacy Project',
        catalog: 'wrenai',
        schema: 'public',
        type: 'POSTGRES',
      }),
    };
    const service = new MDLService({
      projectRepository: projectRepository as any,
      deployLogRepository: {
        findOneBy: jest.fn(),
        findLastRuntimeDeployLog: jest.fn(),
      } as any,
      modelRepository: {
        findAllByRuntimeIdentity: jest.fn().mockResolvedValue([]),
      } as any,
      modelColumnRepository: {
        findColumnsByModelIds: jest.fn().mockResolvedValue([]),
      } as any,
      modelNestedColumnRepository: {
        findNestedColumnsByModelIds: jest.fn().mockResolvedValue([]),
      } as any,
      relationRepository: {
        findRelationInfoBy: jest.fn().mockResolvedValue([]),
      } as any,
      viewRepository: {
        findAllByRuntimeIdentity: jest.fn().mockResolvedValue([]),
      } as any,
    } as any);

    const result = await service.makeCurrentModelMDLByRuntimeIdentity({
      projectId: 91,
      workspaceId: null,
      knowledgeBaseId: null,
      kbSnapshotId: null,
      deployHash: null,
    });

    expect(result.project.id).toBe(91);
    expect(projectRepository.findOneBy).toHaveBeenCalledWith({ id: 91 });
  });
});
