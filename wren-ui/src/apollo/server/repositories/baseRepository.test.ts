import { BaseRepository } from './baseRepository';

interface DummyRecord {
  id: string;
  workspaceId: string;
  createdAt: string;
}

class DummyRepository extends BaseRepository<DummyRecord> {
  constructor(knexPg: any) {
    super({ knexPg, tableName: 'dummy_table' });
  }
}

const buildKnexRows = (rows: any[]) => {
  const builder: any = {
    where: jest.fn(() => builder),
    orderBy: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    then: (
      resolve: (value: any[]) => unknown,
      reject?: (reason: any) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };

  const knex = jest.fn(() => builder);
  return { knex, builder };
};

describe('BaseRepository ordering', () => {
  it('parses "column desc" order expressions in findAllBy', async () => {
    const { knex, builder } = buildKnexRows([]);
    const repository = new DummyRepository(knex as any);

    await repository.findAllBy(
      { workspaceId: 'workspace-1' },
      { order: 'created_at desc' },
    );

    expect(builder.orderBy).toHaveBeenCalledWith('created_at', 'desc');
  });

  it('parses comma-separated order expressions in findAll', async () => {
    const { knex, builder } = buildKnexRows([]);
    const repository = new DummyRepository(knex as any);

    await repository.findAll({ order: 'created_at desc, id asc' });

    expect(builder.orderBy).toHaveBeenNthCalledWith(1, 'created_at', 'desc');
    expect(builder.orderBy).toHaveBeenNthCalledWith(2, 'id', 'asc');
  });
});
