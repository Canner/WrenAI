import { AskingTaskRepository } from './askingTaskRepository';

const buildKnexBuilder = (row: any | null) => {
  const builder: any = {
    where: jest.fn(() => builder),
    andWhere: jest.fn(() => builder),
    whereNull: jest.fn(() => builder),
    first: jest.fn().mockResolvedValue(row),
  };

  const knex = jest.fn(() => builder);
  return { knex, builder };
};

describe('AskingTaskRepository runtime scope query', () => {
  it('skips project bridge filtering when canonical runtime scope is present', async () => {
    const { knex, builder } = buildKnexBuilder({
      id: 1,
      query_id: 'query-1',
      project_id: null,
      workspace_id: 'workspace-1',
      knowledge_base_id: 'kb-1',
      kb_snapshot_id: 'snapshot-1',
      deploy_hash: 'deploy-1',
    });
    const repository = new AskingTaskRepository(knex as unknown as any);

    await repository.findByQueryIdWithRuntimeScope('query-1', {
      projectId: 42,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
    });

    expect(knex).toHaveBeenCalledWith('asking_task');
    expect(builder.where).toHaveBeenCalledWith({ query_id: 'query-1' });
    expect(builder.andWhere).not.toHaveBeenCalledWith('project_id', 42);
    expect(builder.andWhere).toHaveBeenCalledWith(
      'workspace_id',
      'workspace-1',
    );
    expect(builder.andWhere).toHaveBeenCalledWith('knowledge_base_id', 'kb-1');
    expect(builder.andWhere).toHaveBeenCalledWith(
      'kb_snapshot_id',
      'snapshot-1',
    );
    expect(builder.andWhere).toHaveBeenCalledWith('deploy_hash', 'deploy-1');
  });

  it('requires null legacy project when runtime project scope is null', async () => {
    const { knex, builder } = buildKnexBuilder(null);
    const repository = new AskingTaskRepository(knex as unknown as any);

    await repository.findByQueryIdWithRuntimeScope('query-1', {
      projectId: null,
      workspaceId: null,
      knowledgeBaseId: null,
      kbSnapshotId: null,
      deployHash: null,
    });

    expect(builder.whereNull).toHaveBeenCalledWith('project_id');
  });

  it('skips project null filtering when canonical runtime scope is present', async () => {
    const { knex, builder } = buildKnexBuilder(null);
    const repository = new AskingTaskRepository(knex as unknown as any);

    await repository.findByQueryIdWithRuntimeScope('query-1', {
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: null,
      deployHash: null,
    });

    expect(builder.whereNull).not.toHaveBeenCalledWith('project_id');
    expect(builder.andWhere).toHaveBeenCalledWith(
      'workspace_id',
      'workspace-1',
    );
    expect(builder.andWhere).toHaveBeenCalledWith('knowledge_base_id', 'kb-1');
  });

  it('pins project bridge filtering when only legacy runtime scope exists', async () => {
    const { knex, builder } = buildKnexBuilder(null);
    const repository = new AskingTaskRepository(knex as unknown as any);

    await repository.findOneByIdWithRuntimeScope(9, {
      projectId: 42,
      workspaceId: null,
      knowledgeBaseId: null,
      kbSnapshotId: null,
      deployHash: null,
    });

    expect(builder.where).toHaveBeenCalledWith({ id: 9 });
    expect(builder.andWhere).toHaveBeenCalledWith('project_id', 42);
  });
});
