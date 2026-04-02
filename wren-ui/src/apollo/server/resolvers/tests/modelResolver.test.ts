import { ModelResolver } from '../modelResolver';
import { ExpressionName } from '../../models';
import { RelationType } from '../../types';

describe('ModelResolver scope guards', () => {
  const createContext = () =>
    ({
      runtimeScope: {
        project: { id: 1 },
      },
      telemetry: { sendEvent: jest.fn() },
      modelRepository: {
        findAllByIds: jest.fn(),
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
        createCalculatedFieldScoped: jest.fn(),
        updateCalculatedFieldScoped: jest.fn(),
        validateCalculatedFieldNaming: jest.fn(),
      },
      queryService: {
        preview: jest.fn(),
      },
      deployService: {
        getLastDeployment: jest.fn(),
      },
    }) as any;

  it('rejects getModel for models outside the active runtime scope', async () => {
    const resolver = new ModelResolver();
    const ctx = createContext();
    ctx.modelRepository.findAllByIds.mockResolvedValue([
      { id: 7, projectId: 2 },
    ]);

    await expect(
      resolver.getModel(null, { where: { id: 7 } }, ctx),
    ).rejects.toThrow('Model not found');

    expect(ctx.modelColumnRepository.findColumnsByModelIds).not.toHaveBeenCalled();
  });

  it('rejects createRelation when referenced models are outside the active scope', async () => {
    const resolver = new ModelResolver();
    const ctx = createContext();
    ctx.modelRepository.findAllByIds.mockResolvedValue([
      { id: 10, projectId: 1 },
      { id: 11, projectId: 2 },
    ]);

    await expect(
      resolver.createRelation(
        null,
        {
          data: {
            fromModelId: 10,
            toModelId: 11,
            fromColumnId: 100,
            toColumnId: 101,
            type: RelationType.ONE_TO_MANY,
          },
        },
        ctx,
      ),
    ).rejects.toThrow('Model not found');

    expect(ctx.modelService.createRelation).not.toHaveBeenCalled();
  });

  it('rejects updateCalculatedField for calculated fields outside the active scope', async () => {
    const resolver = new ModelResolver();
    const ctx = createContext();
    ctx.modelColumnRepository.findOneBy.mockResolvedValue({
      id: 9,
      modelId: 3,
      isCalculated: true,
    });
    ctx.modelRepository.findAllByIds.mockResolvedValue([
      { id: 3, projectId: 2 },
    ]);

    await expect(
      resolver.updateCalculatedField(
        null,
        {
          where: { id: 9 },
          data: {
            name: 'profit',
            expression: ExpressionName.SUM,
            lineage: [1, 2, 3],
          },
        },
        ctx,
      ),
    ).rejects.toThrow('Calculated field not found');

    expect(ctx.modelService.updateCalculatedFieldScoped).not.toHaveBeenCalled();
  });

  it('rejects validateCalculatedField when modelId is outside the active scope', async () => {
    const resolver = new ModelResolver();
    const ctx = createContext();
    ctx.modelRepository.findAllByIds.mockResolvedValue([{ id: 3, projectId: 2 }]);

    await expect(
      resolver.validateCalculatedField(
        null,
        {
          data: {
            name: 'profit',
            modelId: 3,
            columnId: undefined,
          },
        },
        ctx,
      ),
    ).rejects.toThrow('Model not found');

    expect(ctx.modelService.validateCalculatedFieldNaming).not.toHaveBeenCalled();
  });

  it('rejects previewSql when projectId does not match the active runtime scope', async () => {
    const resolver = new ModelResolver();
    const ctx = createContext();

    await expect(
      resolver.previewSql(
        null,
        {
          data: {
            sql: 'select 1',
            projectId: '2',
            limit: 10,
            dryRun: true,
          },
        },
        ctx,
      ),
    ).rejects.toThrow('previewSql projectId does not match active runtime scope');

    expect(ctx.queryService.preview).not.toHaveBeenCalled();
    expect(ctx.deployService.getLastDeployment).not.toHaveBeenCalled();
  });

  it('rejects getView for views outside the active runtime scope', async () => {
    const resolver = new ModelResolver();
    const ctx = createContext();
    ctx.viewRepository.findOneBy.mockResolvedValue({
      id: 4,
      projectId: 2,
      name: 'orders_view',
      properties: JSON.stringify({ displayName: 'Orders' }),
    });

    await expect(
      resolver.getView(null, { where: { id: 4 } }, ctx),
    ).rejects.toThrow('View not found');
  });
});
