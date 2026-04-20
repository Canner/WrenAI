import { ModelService } from '../modelService';
import { RelationType } from '../../types';

describe('ModelService relation invariants', () => {
  const createService = () => {
    const modelRepository = {
      findAllByIds: jest.fn(),
      findOneBy: jest.fn(),
      findAllByRuntimeIdentity: jest.fn(),
      findAllByIdsWithRuntimeIdentity: jest.fn(),
    };
    const modelColumnRepository = {
      findColumnsByIds: jest.fn(),
      findColumnsByModelIds: jest.fn().mockResolvedValue([]),
      findAllBy: jest.fn(),
      findOneBy: jest.fn(),
      createOne: jest.fn(),
      updateOne: jest.fn(),
    };
    const relationRepository = {
      createMany: jest.fn(),
      createOne: jest.fn(),
      findOneBy: jest.fn(),
      findOneByIdWithRuntimeIdentity: jest.fn(),
      updateOne: jest.fn(),
      deleteOne: jest.fn(),
      findExistedRelationBetweenModels: jest.fn().mockResolvedValue([]),
    };
    const viewRepository = {
      findAllBy: jest.fn(),
      findOneBy: jest.fn(),
      findAllByRuntimeIdentity: jest.fn(),
      findOneByIdWithRuntimeIdentity: jest.fn(),
    };

    const service = new ModelService({
      projectService: {} as any,
      modelRepository: modelRepository as any,
      modelColumnRepository: modelColumnRepository as any,
      relationRepository: relationRepository as any,
      viewRepository: viewRepository as any,
      mdlService: {} as any,
      wrenEngineAdaptor: {} as any,
      queryService: {} as any,
    });

    return {
      service,
      modelRepository,
      modelColumnRepository,
      relationRepository,
      viewRepository,
    };
  };

  it('rejects saveRelations when models span multiple projects', async () => {
    const {
      service,
      modelRepository,
      modelColumnRepository,
      relationRepository,
    } = createService();

    modelRepository.findAllByIds.mockResolvedValue([
      { id: 1, projectId: 42, sourceTableName: 'orders' },
      { id: 2, projectId: 99, sourceTableName: 'customers' },
    ]);
    modelColumnRepository.findColumnsByIds.mockResolvedValue([
      { id: 11, modelId: 1, referenceName: 'customer_id' },
      { id: 22, modelId: 2, referenceName: 'id' },
    ]);

    await expect(
      service.saveRelations([
        {
          fromModelId: 1,
          fromColumnId: 11,
          toModelId: 2,
          toColumnId: 22,
          type: RelationType.ONE_TO_MANY,
        },
      ]),
    ).rejects.toThrow('Relations must belong to a single project');

    expect(relationRepository.createMany).not.toHaveBeenCalled();
  });

  it('persists imported relations with canonical runtime fields while keeping the bridge project for bridge-based deploys', async () => {
    const {
      service,
      modelRepository,
      modelColumnRepository,
      relationRepository,
    } = createService();

    modelRepository.findAllByIdsWithRuntimeIdentity.mockResolvedValue([
      {
        id: 1,
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        sourceTableName: 'orders',
      },
      {
        id: 2,
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        sourceTableName: 'customers',
      },
    ]);
    modelColumnRepository.findColumnsByIds.mockResolvedValue([
      { id: 11, modelId: 1, referenceName: 'customer_id' },
      { id: 22, modelId: 2, referenceName: 'id' },
    ]);
    relationRepository.createMany.mockResolvedValue([{ id: 9 }]);

    await expect(
      service.saveRelationsByRuntimeIdentity(
        {
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        },
        [
          {
            fromModelId: 1,
            fromColumnId: 11,
            toModelId: 2,
            toColumnId: 22,
            type: RelationType.ONE_TO_MANY,
          },
        ],
        {
          preserveProjectBridge: true,
        },
      ),
    ).resolves.toEqual([{ id: 9 }]);

    expect(relationRepository.createMany).toHaveBeenCalledWith([
      expect.objectContaining({
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
        fromColumnId: 11,
        toColumnId: 22,
        joinType: RelationType.ONE_TO_MANY,
      }),
    ]);
  });

  it('rejects createRelation when columns are missing', async () => {
    const {
      service,
      modelRepository,
      modelColumnRepository,
      relationRepository,
    } = createService();

    modelRepository.findAllByIds.mockResolvedValue([
      { id: 1, projectId: 42, sourceTableName: 'orders' },
      { id: 2, projectId: 42, sourceTableName: 'customers' },
    ]);
    modelColumnRepository.findColumnsByIds.mockResolvedValue([
      { id: 11, modelId: 1, referenceName: 'customer_id' },
    ]);

    await expect(
      service.createRelation({
        fromModelId: 1,
        fromColumnId: 11,
        toModelId: 2,
        toColumnId: 22,
        type: RelationType.ONE_TO_MANY,
      }),
    ).rejects.toThrow('Column not found');

    expect(relationRepository.createOne).not.toHaveBeenCalled();
  });

  it('rejects createCalculatedFieldScoped when model is outside the target project', async () => {
    const { service, modelRepository, modelColumnRepository } = createService();

    modelRepository.findAllByIdsWithRuntimeIdentity.mockResolvedValue([
      {
        id: 1,
        projectId: 99,
      },
    ]);

    await expect(
      service.createCalculatedFieldScoped(42, {
        modelId: 1,
        name: 'profit',
        expression: 'SUM' as any,
        lineage: [1, 2, 3],
      }),
    ).rejects.toThrow('Model not found');

    expect(modelColumnRepository.createOne).not.toHaveBeenCalled();
  });

  it('rejects createCalculatedFieldByRuntimeIdentity when model is outside the runtime scope', async () => {
    const { service, modelRepository, modelColumnRepository } = createService();

    modelRepository.findAllByIdsWithRuntimeIdentity.mockResolvedValue([]);

    await expect(
      service.createCalculatedFieldByRuntimeIdentity(
        {
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        },
        {
          modelId: 1,
          name: 'profit',
          expression: 'SUM' as any,
          lineage: [1, 2, 3],
        },
      ),
    ).rejects.toThrow('Model not found');

    expect(modelColumnRepository.createOne).not.toHaveBeenCalled();
  });

  it('rejects createRelationByRuntimeIdentity when the same relation already exists in the current canonical runtime scope', async () => {
    const {
      service,
      modelRepository,
      modelColumnRepository,
      relationRepository,
    } = createService();

    modelRepository.findAllByIdsWithRuntimeIdentity.mockResolvedValue([
      {
        id: 1,
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        sourceTableName: 'orders',
      },
      {
        id: 2,
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        sourceTableName: 'customers',
      },
    ]);
    modelColumnRepository.findColumnsByIds.mockResolvedValue([
      { id: 11, modelId: 1, referenceName: 'customer_id' },
      { id: 22, modelId: 2, referenceName: 'id' },
    ]);
    relationRepository.findExistedRelationBetweenModels.mockResolvedValue([
      { id: 9 },
    ]);

    const runtimeIdentity = {
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
    };
    const relation = {
      fromModelId: 1,
      fromColumnId: 11,
      toModelId: 2,
      toColumnId: 22,
      type: RelationType.ONE_TO_MANY,
    };

    await expect(
      service.createRelationByRuntimeIdentity(runtimeIdentity, relation),
    ).rejects.toThrow('This relationship already exists.');

    expect(
      relationRepository.findExistedRelationBetweenModels,
    ).toHaveBeenCalledWith(relation, runtimeIdentity);
    expect(relationRepository.createOne).not.toHaveBeenCalled();
  });

  it('returns null from getModelScoped when the model belongs to another project', async () => {
    const { service, modelRepository } = createService();

    modelRepository.findAllByIdsWithRuntimeIdentity.mockResolvedValue([
      { id: 1, projectId: 99, sourceTableName: 'orders' },
    ]);

    await expect(service.getModelScoped(42, 1)).resolves.toBeNull();
  });

  it('delegates listModelsByRuntimeIdentity to the runtime-aware repository query', async () => {
    const { service, modelRepository } = createService();
    modelRepository.findAllByRuntimeIdentity.mockResolvedValue([
      { id: 1, projectId: null, deployHash: 'deploy-1' },
    ]);

    await expect(
      service.listModelsByRuntimeIdentity({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      }),
    ).resolves.toEqual([{ id: 1, projectId: null, deployHash: 'deploy-1' }]);
  });

  it('returns an empty result when getModelsByRuntimeIdentity cannot match all requested models', async () => {
    const { service, modelRepository } = createService();
    modelRepository.findAllByIdsWithRuntimeIdentity.mockResolvedValue([
      { id: 1, projectId: null, deployHash: 'deploy-1' },
    ]);

    await expect(
      service.getModelsByRuntimeIdentity(
        {
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        },
        [1, 2],
      ),
    ).resolves.toEqual([]);
  });

  it('does not re-filter canonical model lookups by a stale project bridge', async () => {
    const { service, modelRepository } = createService();
    modelRepository.findAllByIdsWithRuntimeIdentity.mockResolvedValue([
      { id: 1, projectId: 52, deployHash: 'deploy-1' },
    ]);

    await expect(
      service.getModelsByRuntimeIdentity(
        {
          projectId: 999,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        },
        [1],
      ),
    ).resolves.toEqual([{ id: 1, projectId: 52, deployHash: 'deploy-1' }]);
  });

  it('returns null from getColumnScoped when the column model belongs to another project', async () => {
    const { service, modelRepository, modelColumnRepository } = createService();

    modelColumnRepository.findOneBy.mockResolvedValue({
      id: 9,
      modelId: 7,
    });
    modelRepository.findAllByIdsWithRuntimeIdentity.mockResolvedValue([
      { id: 7, projectId: 99, sourceTableName: 'orders' },
    ]);

    await expect(service.getColumnScoped(42, 9)).resolves.toBeNull();
  });

  it('returns null from getColumnByRuntimeIdentity when the column model is outside the runtime scope', async () => {
    const { service, modelRepository, modelColumnRepository } = createService();

    modelColumnRepository.findOneBy.mockResolvedValue({
      id: 9,
      modelId: 7,
    });
    modelRepository.findAllByIdsWithRuntimeIdentity.mockResolvedValue([]);

    await expect(
      service.getColumnByRuntimeIdentity(
        {
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        },
        9,
      ),
    ).resolves.toBeNull();
  });

  it('rejects updateCalculatedFieldScoped when column is outside the target project', async () => {
    const { service, modelRepository, modelColumnRepository } = createService();

    modelColumnRepository.findOneBy.mockResolvedValue({
      id: 9,
      modelId: 7,
    });
    modelRepository.findAllByIdsWithRuntimeIdentity.mockResolvedValue([
      { id: 7, projectId: 99 },
    ]);

    await expect(
      service.updateCalculatedFieldScoped(
        42,
        {
          name: 'profit',
          expression: 'SUM' as any,
          lineage: [1, 2, 3],
        },
        9,
      ),
    ).rejects.toThrow('Column not found');

    expect(modelColumnRepository.updateOne).not.toHaveBeenCalled();
  });

  it('rejects updateCalculatedFieldByRuntimeIdentity when the column is outside the runtime scope', async () => {
    const { service, modelRepository, modelColumnRepository } = createService();

    modelColumnRepository.findOneBy.mockResolvedValue({
      id: 9,
      modelId: 7,
    });
    modelRepository.findAllByIdsWithRuntimeIdentity.mockResolvedValue([]);

    await expect(
      service.updateCalculatedFieldByRuntimeIdentity(
        {
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        },
        {
          name: 'profit',
          expression: 'SUM' as any,
          lineage: [1, 2, 3],
        },
        9,
      ),
    ).rejects.toThrow('Column not found');

    expect(modelColumnRepository.updateOne).not.toHaveBeenCalled();
  });

  it('rejects updateRelation when relation is outside the target project', async () => {
    const { service, relationRepository } = createService();

    relationRepository.findOneBy.mockResolvedValue({
      id: 9,
      projectId: 99,
    });

    await expect(
      service.updateRelation(
        42,
        {
          type: RelationType.ONE_TO_MANY,
        },
        9,
      ),
    ).rejects.toThrow('Relation not found');

    expect(relationRepository.updateOne).not.toHaveBeenCalled();
  });

  it('rejects deleteRelation when relation is outside the target project', async () => {
    const { service, relationRepository, modelColumnRepository } =
      createService();

    relationRepository.findOneBy.mockResolvedValue({
      id: 9,
      projectId: 99,
    });
    modelColumnRepository.findAllBy.mockResolvedValue([]);

    await expect(service.deleteRelation(42, 9)).rejects.toThrow(
      'Relation not found',
    );

    expect(relationRepository.deleteOne).not.toHaveBeenCalled();
  });

  it('delegates getRelationByRuntimeIdentity to the runtime-aware repository query', async () => {
    const { service, relationRepository } = createService();

    relationRepository.findOneByIdWithRuntimeIdentity.mockResolvedValue({
      id: 9,
      projectId: null,
      deployHash: 'deploy-1',
      name: 'runtime_relation',
    });

    await expect(
      service.getRelationByRuntimeIdentity(
        {
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        },
        9,
      ),
    ).resolves.toEqual({
      id: 9,
      projectId: null,
      deployHash: 'deploy-1',
      name: 'runtime_relation',
    });
  });

  it('persists runtime identity fields and the active bridge project when creating relations by runtime identity', async () => {
    const {
      service,
      modelRepository,
      modelColumnRepository,
      relationRepository,
    } = createService();
    modelRepository.findAllByIdsWithRuntimeIdentity.mockResolvedValue([
      { id: 1, projectId: 42, sourceTableName: 'orders' },
      { id: 2, projectId: 42, sourceTableName: 'customers' },
    ]);
    modelColumnRepository.findColumnsByIds.mockResolvedValue([
      { id: 11, modelId: 1, referenceName: 'customer_id' },
      { id: 22, modelId: 2, referenceName: 'id' },
    ]);
    relationRepository.createOne.mockResolvedValue({ id: 9 });

    await service.createRelationByRuntimeIdentity(
      {
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      },
      {
        fromModelId: 1,
        fromColumnId: 11,
        toModelId: 2,
        toColumnId: 22,
        type: RelationType.ONE_TO_MANY,
      },
    );

    expect(relationRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      }),
    );
  });

  it('replaces a stale project bridge with the active model project when persisting canonical runtime-scoped relations', async () => {
    const {
      service,
      modelRepository,
      modelColumnRepository,
      relationRepository,
    } = createService();
    modelRepository.findAllByIdsWithRuntimeIdentity.mockResolvedValue([
      { id: 1, projectId: 42, sourceTableName: 'orders' },
      { id: 2, projectId: 42, sourceTableName: 'customers' },
    ]);
    modelColumnRepository.findColumnsByIds.mockResolvedValue([
      { id: 11, modelId: 1, referenceName: 'customer_id' },
      { id: 22, modelId: 2, referenceName: 'id' },
    ]);
    relationRepository.createOne.mockResolvedValue({ id: 19 });

    await service.createRelationByRuntimeIdentity(
      {
        projectId: 999,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      },
      {
        fromModelId: 1,
        fromColumnId: 11,
        toModelId: 2,
        toColumnId: 22,
        type: RelationType.ONE_TO_MANY,
      },
    );

    expect(relationRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      }),
    );
  });

  it('allows runtime-scoped relation creation when models no longer carry a project bridge', async () => {
    const {
      service,
      modelRepository,
      modelColumnRepository,
      relationRepository,
    } = createService();
    modelRepository.findAllByIdsWithRuntimeIdentity.mockResolvedValue([
      {
        id: 1,
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        sourceTableName: 'orders',
      },
      {
        id: 2,
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        sourceTableName: 'customers',
      },
    ]);
    modelColumnRepository.findColumnsByIds.mockResolvedValue([
      { id: 11, modelId: 1, referenceName: 'customer_id' },
      { id: 22, modelId: 2, referenceName: 'id' },
    ]);
    relationRepository.createOne.mockResolvedValue({ id: 10 });

    await expect(
      service.createRelationByRuntimeIdentity(
        {
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        },
        {
          fromModelId: 1,
          fromColumnId: 11,
          toModelId: 2,
          toColumnId: 22,
          type: RelationType.ONE_TO_MANY,
        },
      ),
    ).resolves.toEqual({ id: 10 });

    expect(relationRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: null,
        deployHash: 'deploy-1',
      }),
    );
  });

  it('returns null from getViewScoped when the view belongs to another project', async () => {
    const { service, viewRepository } = createService();

    viewRepository.findOneByIdWithRuntimeIdentity.mockResolvedValue({
      id: 8,
      projectId: 99,
      name: 'foreign_view',
    });

    await expect(service.getViewScoped(42, 8)).resolves.toBeNull();
  });

  it('delegates getViewByRuntimeIdentity to the runtime-aware repository query', async () => {
    const { service, viewRepository } = createService();
    viewRepository.findOneByIdWithRuntimeIdentity.mockResolvedValue({
      id: 8,
      projectId: null,
      deployHash: 'deploy-1',
      name: 'runtime_view',
    });

    await expect(
      service.getViewByRuntimeIdentity(
        {
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        },
        8,
      ),
    ).resolves.toEqual({
      id: 8,
      projectId: null,
      deployHash: 'deploy-1',
      name: 'runtime_view',
    });
  });

  it('returns null from getRelationScoped when the relation belongs to another project', async () => {
    const { service, relationRepository } = createService();

    relationRepository.findOneByIdWithRuntimeIdentity.mockResolvedValue({
      id: 8,
      projectId: 99,
      name: 'foreign_relation',
    });

    await expect(service.getRelationScoped(42, 8)).resolves.toBeNull();
  });

  it('rejects validateViewNameScoped when the generated reference name duplicates an existing view', async () => {
    const { service, viewRepository } = createService();

    viewRepository.findAllByRuntimeIdentity.mockResolvedValue([
      { id: 5, projectId: 42, name: 'Orders_View' },
    ]);

    await expect(
      service.validateViewNameScoped(42, 'Orders View'),
    ).resolves.toEqual({
      valid: false,
      message: 'Generated view name "Orders_View" is duplicated',
    });
    expect(viewRepository.findAllByRuntimeIdentity).toHaveBeenCalledWith({
      projectId: 42,
      workspaceId: null,
      knowledgeBaseId: null,
      kbSnapshotId: null,
      deployHash: null,
      actorUserId: null,
    });
  });

  it('routes legacy scoped model lookups through runtime-aware repository queries before enforcing the project bridge', async () => {
    const { service, modelRepository } = createService();

    modelRepository.findAllByIdsWithRuntimeIdentity.mockResolvedValue([
      { id: 7, projectId: 42, sourceTableName: 'orders' },
    ]);

    await expect(service.getModelScoped(42, 7)).resolves.toEqual({
      id: 7,
      projectId: 42,
      sourceTableName: 'orders',
    });
    expect(
      modelRepository.findAllByIdsWithRuntimeIdentity,
    ).toHaveBeenCalledWith([7], {
      projectId: 42,
      workspaceId: null,
      knowledgeBaseId: null,
      kbSnapshotId: null,
      deployHash: null,
      actorUserId: null,
    });
  });

  it('rejects validateViewNameByRuntimeIdentity when a runtime-scoped view duplicates the generated name', async () => {
    const { service, viewRepository } = createService();

    viewRepository.findAllByRuntimeIdentity.mockResolvedValue([
      { id: 5, projectId: null, name: 'Orders_View', deployHash: 'deploy-1' },
    ]);

    await expect(
      service.validateViewNameByRuntimeIdentity(
        {
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        },
        'Orders View',
      ),
    ).resolves.toEqual({
      valid: false,
      message: 'Generated view name "Orders_View" is duplicated',
    });
  });
});

export {};
