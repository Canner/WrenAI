import { ModelController } from '../modelController';
import { ExpressionName } from '../../models';
import { RelationType } from '../../types';
import {
  createContext,
  restoreModelControllerBindingMode,
} from './modelController.testSupport';

describe('ModelController scope guards', () => {
  afterEach(() => {
    restoreModelControllerBindingMode();
  });

  it('rejects createModel without knowledge base write permission', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.authorizationActor = {
      ...ctx.authorizationActor,
      workspaceRoleKeys: ['owner'],
      permissionScopes: ['workspace:*'],
      grantedActions: [],
      workspaceRoleSource: 'legacy',
      platformRoleSource: 'legacy',
    };

    await expect(
      resolver.createModel({
        data: {
          sourceTableName: 'orders',
          fields: ['id'],
          primaryKey: 'id',
        },
        ctx,
      }),
    ).rejects.toThrow('Knowledge base write permission required');

    expect(ctx.modelRepository.createOne).not.toHaveBeenCalled();
  });

  it('records allowed audit when listing models', async () => {
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.modelService.listModelsByRuntimeIdentity.mockResolvedValue([
      {
        id: 7,
        properties: JSON.stringify({ description: 'orders table' }),
      },
    ]);
    ctx.modelColumnRepository.findColumnsByModelIds.mockResolvedValue([]);
    ctx.modelNestedColumnRepository.findNestedColumnsByModelIds = jest
      .fn()
      .mockResolvedValue([]);

    await resolver.listModels({ ctx });

    expect(ctx.auditEventRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge_base.read',
        resourceType: 'knowledge_base',
        resourceId: 'kb-1',
        result: 'allowed',
        payloadJson: {
          operation: 'list_models',
        },
      }),
    );
  });

  it('rejects listModels without knowledge base read permission in binding-only mode', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.authorizationActor = {
      ...ctx.authorizationActor,
      workspaceRoleKeys: ['owner'],
      permissionScopes: ['workspace:*'],
      grantedActions: [],
      workspaceRoleSource: 'legacy',
      platformRoleSource: 'legacy',
    };

    await expect(resolver.listModels({ ctx })).rejects.toThrow(
      'Knowledge base read permission required',
    );

    expect(ctx.modelService.listModelsByRuntimeIdentity).not.toHaveBeenCalled();
  });

  it('rejects getModel for models outside the active runtime scope', async () => {
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.modelService.getModelByRuntimeIdentity.mockResolvedValue(null);

    await expect(resolver.getModel({ modelId: 7, ctx })).rejects.toThrow(
      'Model not found',
    );

    expect(
      ctx.modelColumnRepository.findColumnsByModelIds,
    ).not.toHaveBeenCalled();
  });

  it('rejects createRelation when referenced models are outside the active scope', async () => {
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.modelService.getModelsByRuntimeIdentity.mockResolvedValue([]);

    await expect(
      resolver.createRelation({
        data: {
          fromModelId: 10,
          toModelId: 11,
          fromColumnId: 100,
          toColumnId: 101,
          type: RelationType.ONE_TO_MANY,
        },
        ctx,
      }),
    ).rejects.toThrow('Model not found');

    expect(
      ctx.modelService.createRelationByRuntimeIdentity,
    ).not.toHaveBeenCalled();
  });

  it('rejects updateRelation when the relation is outside the active runtime scope', async () => {
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.modelService.getRelationByRuntimeIdentity.mockResolvedValue(null);

    await expect(
      resolver.updateRelation({
        relationId: 5,
        data: { type: RelationType.ONE_TO_MANY },
        ctx,
      }),
    ).rejects.toThrow('Relation not found');

    expect(
      ctx.modelService.updateRelationByRuntimeIdentity,
    ).not.toHaveBeenCalled();
  });

  it('rejects updateCalculatedField for calculated fields outside the active scope', async () => {
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.modelService.getColumnByRuntimeIdentity.mockResolvedValue(null);

    await expect(
      resolver.updateCalculatedField({
        columnId: 9,
        data: {
          name: 'profit',
          expression: ExpressionName.SUM,
          lineage: [1, 2, 3],
        },
        ctx,
      }),
    ).rejects.toThrow('Calculated field not found');

    expect(
      ctx.modelService.updateCalculatedFieldByRuntimeIdentity,
    ).not.toHaveBeenCalled();
  });

  it('rejects validateCalculatedField when modelId is outside the active scope', async () => {
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.modelService.getModelsScoped.mockResolvedValue([]);

    await expect(
      resolver.validateCalculatedField({
        name: 'profit',
        modelId: 3,
        columnId: undefined,
        ctx,
      }),
    ).rejects.toThrow('Model not found');

    expect(
      ctx.modelService.validateCalculatedFieldNaming,
    ).not.toHaveBeenCalled();
  });

  it('rejects validateCalculatedField without knowledge base write permission in binding-only mode', async () => {
    process.env.WREN_AUTHORIZATION_BINDING_MODE = 'binding_only';
    const resolver = new ModelController();
    const ctx = createContext();
    ctx.authorizationActor = {
      ...ctx.authorizationActor,
      grantedActions: [],
      workspaceRoleSource: 'legacy',
      platformRoleSource: 'legacy',
    };

    await expect(
      resolver.validateCalculatedField({
        name: 'profit',
        modelId: 1,
        columnId: undefined,
        ctx,
      }),
    ).rejects.toThrow('Knowledge base write permission required');

    expect(
      ctx.modelService.validateCalculatedFieldNaming,
    ).not.toHaveBeenCalled();
  });
});
