import { ThreadRepository } from './threadRepository';

const buildKnexRows = (rows: any[]) => {
  const builder: any = {
    where: jest.fn(() => builder),
    andWhere: jest.fn(() => builder),
    whereNull: jest.fn(() => builder),
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

describe('ThreadRepository runtime scope query', () => {
  it('pins legacy runtimeScopeId queries to the exact project bridge', async () => {
    const { knex, builder } = buildKnexRows([
      {
        id: 101,
        project_id: null,
        workspace_id: 'workspace-1',
        knowledge_base_id: 'kb-1',
        kb_snapshot_id: 'snapshot-1',
        deploy_hash: 'deploy-1',
      },
    ]);
    const repository = new ThreadRepository(knex as unknown as any);

    await repository.findOneByIdWithRuntimeScope(101, {
      projectId: 42,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
    });

    expect(builder.andWhere).toHaveBeenCalledWith('project_id', 42);
    expect(builder.where).toHaveBeenCalledWith({ id: 101 });
    expect(builder.first).toHaveBeenCalled();
  });

  it('requires null project scope when runtime project is null', async () => {
    const { knex, builder } = buildKnexRows([]);
    const repository = new ThreadRepository(knex as unknown as any);

    await repository.listAllTimeDescOrderByScope({
      projectId: null,
      workspaceId: null,
      knowledgeBaseId: null,
      kbSnapshotId: null,
      deployHash: null,
    });

    expect(builder.whereNull).toHaveBeenCalledWith('project_id');
    expect(builder.orderBy).toHaveBeenCalledWith('created_at', 'desc');
  });

  it('skips project null filtering when canonical runtime scope is present', async () => {
    const { knex, builder } = buildKnexRows([]);
    const repository = new ThreadRepository(knex as unknown as any);

    await repository.listAllTimeDescOrderByScope({
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

  it('lists workspace history across all knowledge bases when only workspace scope is provided', async () => {
    const { knex, builder } = buildKnexRows([]);
    const repository = new ThreadRepository(knex as unknown as any);

    await repository.listAllTimeDescOrderByScope({
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: null,
      kbSnapshotId: null,
      deployHash: null,
    });

    expect(builder.andWhere).toHaveBeenCalledWith(
      'workspace_id',
      'workspace-1',
    );
    expect(builder.whereNull).not.toHaveBeenCalledWith('knowledge_base_id');
    expect(builder.whereNull).not.toHaveBeenCalledWith('kb_snapshot_id');
    expect(builder.whereNull).not.toHaveBeenCalledWith('deploy_hash');
  });
});
