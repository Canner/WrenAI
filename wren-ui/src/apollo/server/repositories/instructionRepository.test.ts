import { InstructionRepository } from './instructionRepository';

const buildKnexRows = (rows: any[]) => {
  const builder: any = {
    where: jest.fn(() => builder),
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

describe('InstructionRepository runtime scope query', () => {
  it('treats projectId as fallback when canonical runtime scope exists', async () => {
    const { knex, builder } = buildKnexRows([]);
    const repository = new InstructionRepository(knex as unknown as any);

    await repository.findAllByRuntimeIdentity({
      projectId: 42,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
    });

    expect(builder.andWhere).toHaveBeenCalledTimes(4);
    expect(builder.whereNull).not.toHaveBeenCalledWith('project_id');
    expect(builder.andWhere).toHaveBeenCalledWith(
      'workspace_id',
      'workspace-1',
    );
    expect(builder.andWhere).toHaveBeenCalledWith('knowledge_base_id', 'kb-1');
  });

  it('pins legacy runtimeScopeId queries to the exact project bridge', async () => {
    const { knex, builder } = buildKnexRows([]);
    const repository = new InstructionRepository(knex as unknown as any);

    await repository.findAllByRuntimeIdentity({
      projectId: 42,
      workspaceId: null,
      knowledgeBaseId: null,
      kbSnapshotId: null,
      deployHash: null,
    });

    expect(builder.andWhere).toHaveBeenCalledWith('project_id', 42);
  });
});
