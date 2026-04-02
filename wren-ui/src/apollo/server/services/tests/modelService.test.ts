import { ModelService } from '../modelService';
import { RelationType } from '../../types';

describe('ModelService relation invariants', () => {
  const createService = () => {
    const modelRepository = {
      findAllByIds: jest.fn(),
      findOneBy: jest.fn(),
    };
    const modelColumnRepository = {
      findColumnsByIds: jest.fn(),
      findAllBy: jest.fn(),
      findOneBy: jest.fn(),
      createOne: jest.fn(),
      updateOne: jest.fn(),
    };
    const relationRepository = {
      createMany: jest.fn(),
      createOne: jest.fn(),
      findOneBy: jest.fn(),
      updateOne: jest.fn(),
      deleteOne: jest.fn(),
      findExistedRelationBetweenModels: jest.fn().mockResolvedValue([]),
    };

    const service = new ModelService({
      projectService: {} as any,
      modelRepository: modelRepository as any,
      modelColumnRepository: modelColumnRepository as any,
      relationRepository: relationRepository as any,
      viewRepository: {} as any,
      mdlService: {} as any,
      wrenEngineAdaptor: {} as any,
      queryService: {} as any,
    });

    return { service, modelRepository, modelColumnRepository, relationRepository };
  };

  it('rejects saveRelations when models span multiple projects', async () => {
    const { service, modelRepository, modelColumnRepository, relationRepository } =
      createService();

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

  it('rejects createRelation when columns are missing', async () => {
    const { service, modelRepository, modelColumnRepository, relationRepository } =
      createService();

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

    modelRepository.findOneBy.mockResolvedValue({
      id: 1,
      projectId: 99,
    });

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

  it('rejects updateCalculatedFieldScoped when column is outside the target project', async () => {
    const { service, modelRepository, modelColumnRepository } = createService();

    modelColumnRepository.findOneBy.mockResolvedValue({
      id: 9,
      modelId: 7,
    });
    modelRepository.findOneBy.mockResolvedValue({
      id: 7,
      projectId: 99,
    });

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
});

export {};
