import { SkillDefinitionRepository } from './skillDefinitionRepository';

const buildKnexRows = (rows: any[]) => {
  const builder: any = {
    where: jest.fn(() => builder),
    orderBy: jest.fn(() => builder),
    first: jest.fn().mockResolvedValue(rows[0] ?? null),
    then: (
      resolve: (value: any[]) => unknown,
      reject?: (reason: any) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };

  const knex = jest.fn(() => builder);
  return { knex, builder };
};

describe('SkillDefinitionRepository', () => {
  it('parses V2 json columns from the database payload', async () => {
    const { knex } = buildKnexRows([
      {
        id: 'skill-1',
        workspace_id: 'workspace-1',
        name: 'sales_skill',
        runtime_kind: 'isolated_python',
        source_type: 'inline',
        manifest_json: '{"entry":"main.py"}',
        runtime_config_json: '{"timeoutSec":30}',
        kb_suggestion_ids: '["kb-1","kb-2"]',
      },
    ]);
    const repository = new SkillDefinitionRepository(knex as any);

    const result = await repository.findAllBy({ workspaceId: 'workspace-1' });

    expect(result).toEqual([
      expect.objectContaining({
        manifestJson: { entry: 'main.py' },
        runtimeConfigJson: { timeoutSec: 30 },
        kbSuggestionIds: ['kb-1', 'kb-2'],
      }),
    ]);
  });

  it('filters available skills by workspace and enabled flag', async () => {
    const { knex, builder } = buildKnexRows([]);
    const repository = new SkillDefinitionRepository(knex as any);

    await repository.listAvailableSkillsByWorkspace('workspace-1');

    expect(builder.where).toHaveBeenCalledWith({
      workspace_id: 'workspace-1',
      is_enabled: true,
    });
  });

  it('finds migrated runtime skill by source binding id', async () => {
    const { knex, builder } = buildKnexRows([]);
    const repository = new SkillDefinitionRepository(knex as any);

    await repository.findOneByMigrationSourceBindingId('binding-1');

    expect(builder.where).toHaveBeenCalledWith({
      migration_source_binding_id: 'binding-1',
    });
  });

  it('scopes catalog lookups to the active workspace', async () => {
    const { knex, builder } = buildKnexRows([]);
    const repository = new SkillDefinitionRepository(knex as any);

    await repository.findAllByCatalogId('workspace-1', 'catalog-1');

    expect(builder.where).toHaveBeenCalledWith({
      workspace_id: 'workspace-1',
      catalog_id: 'catalog-1',
    });
  });
});
