import { DeployLogRepository, DeployStatusEnum } from './deployLogRepository';

const buildKnexBuilder = (rows: any[]) => {
  const builder: any = {
    select: jest.fn(() => builder),
    from: jest.fn(() => builder),
    where: jest.fn(() => builder),
    andWhere: jest.fn(() => builder),
    orderBy: jest.fn(() => builder),
    first: jest.fn().mockResolvedValue(rows[0] ?? null),
  };

  return {
    knex: {
      select: jest.fn(() => builder),
    },
    builder,
  };
};

describe('DeployLogRepository runtime scope query', () => {
  it('prefers kbSnapshotId as the canonical runtime lookup key', async () => {
    const { knex, builder } = buildKnexBuilder([]);
    const repository = new DeployLogRepository(knex as any);

    await repository.findLastRuntimeDeployLog({
      projectId: 42,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: null,
      actorUserId: null,
    });

    expect(builder.andWhere).toHaveBeenCalledTimes(1);
    expect(builder.andWhere).toHaveBeenCalledWith(
      'kb_snapshot_id',
      'snapshot-1',
    );
  });

  it('falls back to knowledgeBaseId when snapshot scope is unavailable', async () => {
    const { knex, builder } = buildKnexBuilder([]);
    const repository = new DeployLogRepository(knex as any);

    await repository.findLastRuntimeDeployLog({
      projectId: 42,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: null,
      deployHash: null,
      actorUserId: null,
    });

    expect(builder.andWhere).toHaveBeenCalledTimes(1);
    expect(builder.andWhere).toHaveBeenCalledWith('knowledge_base_id', 'kb-1');
  });

  it('falls back to workspaceId when only workspace scope is present', async () => {
    const { knex, builder } = buildKnexBuilder([]);
    const repository = new DeployLogRepository(knex as any);

    await repository.findInProgressRuntimeDeployLog({
      projectId: 42,
      workspaceId: 'workspace-1',
      knowledgeBaseId: null,
      kbSnapshotId: null,
      deployHash: null,
      actorUserId: null,
    });

    expect(builder.where).toHaveBeenCalledWith(
      expect.objectContaining({ status: DeployStatusEnum.IN_PROGRESS }),
    );
    expect(builder.andWhere).toHaveBeenCalledTimes(1);
    expect(builder.andWhere).toHaveBeenCalledWith(
      'workspace_id',
      'workspace-1',
    );
  });

  it('returns null when no canonical runtime scope fields are present', async () => {
    const { knex } = buildKnexBuilder([]);
    const repository = new DeployLogRepository(knex as any);

    await expect(
      repository.findLastRuntimeDeployLog({
        projectId: 42,
        workspaceId: null,
        knowledgeBaseId: null,
        kbSnapshotId: null,
        deployHash: null,
        actorUserId: null,
      }),
    ).resolves.toBeNull();
  });
});
