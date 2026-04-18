import { ModelRepository } from './modelRepository';

const buildKnexRows = (rows: any[]) => {
  const builder: any = {
    where: jest.fn(() => builder),
    whereIn: jest.fn(() => builder),
    andWhere: jest.fn(() => builder),
    whereNull: jest.fn(() => builder),
    first: jest.fn().mockResolvedValue(rows[0] ?? null),
    then: (
      resolve: (value: any[]) => unknown,
      reject?: (reason: any) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };

  const knex = jest.fn(() => builder);
  return { knex, builder };
};

describe('ModelRepository runtime scope query', () => {
  it('maps runtime-scoped rows back to camelCase model fields', async () => {
    const { knex } = buildKnexRows([
      {
        id: 42,
        project_id: 7,
        display_name: 'Orders',
        reference_name: 'orders',
        source_table_name: 'orders',
        ref_sql: null,
        cached: false,
        refresh_time: null,
        properties: null,
      },
    ]);
    const repository = new ModelRepository(knex as unknown as any);

    await expect(
      repository.findAllByRuntimeIdentity({
        projectId: 7,
        workspaceId: null,
        knowledgeBaseId: null,
        kbSnapshotId: null,
        deployHash: null,
        actorUserId: null,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        displayName: 'Orders',
        referenceName: 'orders',
        sourceTableName: 'orders',
      }),
    ]);
  });

  it('keeps legacy runtimeScopeId lookups pinned to the exact project bridge', async () => {
    const { knex, builder } = buildKnexRows([]);
    const repository = new ModelRepository(knex as unknown as any);

    await repository.findAllByRuntimeIdentity({
      projectId: 42,
      workspaceId: null,
      knowledgeBaseId: null,
      kbSnapshotId: null,
      deployHash: null,
      actorUserId: null,
    });

    expect(builder.andWhere).toHaveBeenCalledWith('project_id', 42);
    expect(builder.whereNull).toHaveBeenCalledWith('workspace_id');
    expect(builder.whereNull).toHaveBeenCalledWith('knowledge_base_id');
    expect(builder.whereNull).toHaveBeenCalledWith('kb_snapshot_id');
    expect(builder.whereNull).toHaveBeenCalledWith('deploy_hash');
  });

  it('treats projectId as fallback when canonical runtime scope exists', async () => {
    const { knex, builder } = buildKnexRows([]);
    const repository = new ModelRepository(knex as unknown as any);

    await repository.findAllByRuntimeIdentity({
      projectId: 42,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
    });

    expect(builder.andWhere).toHaveBeenCalledTimes(4);
    expect(builder.whereNull).not.toHaveBeenCalledWith('project_id');
    expect(builder.andWhere).toHaveBeenCalledWith(
      'workspace_id',
      'workspace-1',
    );
    expect(builder.andWhere).toHaveBeenCalledWith('knowledge_base_id', 'kb-1');
  });
});
