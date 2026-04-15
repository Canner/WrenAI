import { SkillMarketplaceCatalogRepository } from './skillMarketplaceCatalogRepository';

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

describe('SkillMarketplaceCatalogRepository', () => {
  it('parses manifest json and finds featured catalog skills', async () => {
    const { knex, builder } = buildKnexRows([
      {
        id: 'catalog-1',
        slug: 'sales-copilot',
        name: 'Sales Copilot',
        version: '1.0.0',
        runtime_kind: 'isolated_python',
        source_type: 'github',
        manifest_json: '{"entry":"main.py"}',
        is_featured: true,
      },
    ]);
    const repository = new SkillMarketplaceCatalogRepository(knex as any);

    const result = await repository.findFeatured();

    expect(builder.where).toHaveBeenCalledWith({ is_featured: true });
    expect(result).toEqual([
      expect.objectContaining({
        manifestJson: { entry: 'main.py' },
      }),
    ]);
  });

  it('finds a catalog skill by slug', async () => {
    const { knex, builder } = buildKnexRows([]);
    const repository = new SkillMarketplaceCatalogRepository(knex as any);

    await repository.findOneBySlug('sales-copilot');

    expect(builder.where).toHaveBeenCalledWith({ slug: 'sales-copilot' });
  });
});
