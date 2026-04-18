import { RelationRepository } from './relationshipRepository';

const buildKnexRows = (rows: any[]) => {
  const builder: any = {
    join: jest.fn(() => builder),
    select: jest.fn(() => builder),
    where: jest.fn(() => builder),
    andWhere: jest.fn(() => builder),
    whereNull: jest.fn(() => builder),
    whereRaw: jest.fn(() => builder),
    first: jest.fn().mockResolvedValue(rows[0] ?? null),
    then: (
      resolve: (value: any[]) => unknown,
      reject?: (reason: any) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };

  const knex = jest.fn(() => builder);
  return { knex, builder };
};

describe('RelationRepository runtime scope query', () => {
  it('treats projectId as fallback when canonical runtime scope exists', async () => {
    const { knex, builder } = buildKnexRows([]);
    const repository = new RelationRepository(knex as unknown as any);

    await repository.findOneByIdWithRuntimeIdentity(1, {
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

  it('scopes duplicate relation lookups to canonical runtime fields', async () => {
    const { knex, builder } = buildKnexRows([]);
    const repository = new RelationRepository(knex as unknown as any);

    await repository.findExistedRelationBetweenModels(
      {
        fromModelId: 1,
        fromColumnId: 11,
        toModelId: 2,
        toColumnId: 22,
        type: 'ONE_TO_MANY' as any,
      },
      {
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      },
    );

    expect(builder.andWhere).toHaveBeenCalledWith(
      'workspace_id',
      'workspace-1',
    );
    expect(builder.andWhere).toHaveBeenCalledWith('knowledge_base_id', 'kb-1');
    expect(builder.whereNull).not.toHaveBeenCalledWith('project_id');
    expect(builder.whereRaw).toHaveBeenCalledWith(
      expect.stringContaining('Or'),
      [1, 11, 2, 22, 2, 22, 1, 11],
    );
  });
});
