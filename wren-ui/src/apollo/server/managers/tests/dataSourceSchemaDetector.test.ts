import DataSourceSchemaDetector from '../dataSourceSchemaDetector';

describe('DataSourceSchemaDetector', () => {
  const projectId = 1;

  const createContext = ({
    models = [],
    columns = [],
    latestTables = [],
    lastSchemaChange = null,
  }: {
    models?: any[];
    columns?: any[];
    latestTables?: any[];
    lastSchemaChange?: any;
  }) =>
    ({
      projectRepository: {
        findOneBy: jest.fn().mockResolvedValue({ id: projectId }),
      },
      projectService: {
        getProjectDataSourceTables: jest.fn().mockResolvedValue(latestTables),
      },
      schemaChangeRepository: {
        findLastSchemaChange: jest.fn().mockResolvedValue(lastSchemaChange),
        createOne: jest.fn(),
        updateOne: jest.fn(),
      },
      modelRepository: {
        findAllBy: jest.fn().mockResolvedValue(models),
      },
      modelColumnRepository: {
        findColumnsByModelIds: jest.fn().mockResolvedValue(columns),
        createOne: jest.fn().mockImplementation((data) =>
          Promise.resolve({
            id: 99,
            ...data,
          }),
        ),
        updateOne: jest.fn().mockImplementation((id, data) =>
          Promise.resolve({
            id,
            modelId: 1,
            sourceColumnName: 'amount',
            ...data,
          }),
        ),
      },
      modelNestedColumnRepository: {
        createMany: jest.fn(),
        deleteAllBy: jest.fn(),
      },
    }) as any;

  it('syncs newly added datasource columns into existing models', async () => {
    const model = {
      id: 10,
      projectId,
      sourceTableName: 'orders',
    };
    const existingColumn = {
      id: 20,
      modelId: 10,
      isCalculated: false,
      displayName: 'id',
      referenceName: 'id',
      sourceColumnName: 'id',
      type: 'int',
      notNull: true,
      isPk: true,
      properties: null,
    };
    const ctx = createContext({
      models: [model],
      columns: [existingColumn],
      latestTables: [
        {
          name: 'orders',
          columns: [
            { name: 'id', type: 'int', notNull: true },
            { name: 'status', type: 'varchar', notNull: false },
          ],
        },
      ],
    });

    const detector = new DataSourceSchemaDetector({ ctx, projectId });

    await expect(detector.detectSchemaChange()).resolves.toBe(true);
    expect(ctx.modelColumnRepository.createOne).toHaveBeenCalledWith({
      modelId: 10,
      isCalculated: false,
      displayName: 'status',
      referenceName: 'status',
      sourceColumnName: 'status',
      type: 'varchar',
      notNull: false,
      isPk: false,
      properties: null,
    });
    expect(ctx.schemaChangeRepository.createOne).not.toHaveBeenCalled();
  });

  it('updates existing column schema attributes without overwriting user properties', async () => {
    const model = {
      id: 10,
      projectId,
      sourceTableName: 'orders',
    };
    const existingColumn = {
      id: 20,
      modelId: 10,
      isCalculated: false,
      displayName: 'Amount',
      referenceName: 'amount',
      sourceColumnName: 'amount',
      type: 'int',
      notNull: false,
      isPk: false,
      properties: JSON.stringify({ description: 'User description' }),
    };
    const ctx = createContext({
      models: [model],
      columns: [existingColumn],
      latestTables: [
        {
          name: 'orders',
          columns: [
            {
              name: 'amount',
              type: 'decimal',
              notNull: true,
              properties: { description: 'Datasource description' },
            },
          ],
        },
      ],
    });

    const detector = new DataSourceSchemaDetector({ ctx, projectId });

    await expect(detector.detectSchemaChange()).resolves.toBe(true);
    expect(ctx.modelColumnRepository.updateOne).toHaveBeenCalledWith(20, {
      type: 'decimal',
      notNull: true,
      properties: JSON.stringify({ description: 'User description' }),
    });
    expect(ctx.schemaChangeRepository.createOne).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        change: {
          modifiedColumns: [
            {
              name: 'orders',
              columns: [
                {
                  name: 'amount',
                  type: 'decimal',
                  notNull: true,
                  properties: { description: 'Datasource description' },
                },
              ],
            },
          ],
        },
      }),
    );
  });

  it('does not report schema changes for qualified or case-only identifier differences', async () => {
    const model = {
      id: 10,
      projectId,
      sourceTableName: 'dbo.Repair_Logs',
    };
    const existingColumn = {
      id: 20,
      modelId: 10,
      isCalculated: false,
      displayName: 'Created At',
      referenceName: 'created_at',
      sourceColumnName: 'created_at',
      type: 'datetime',
      notNull: false,
      isPk: false,
      properties: null,
    };
    const ctx = createContext({
      models: [model],
      columns: [existingColumn],
      latestTables: [
        {
          name: '[repair_logs]',
          columns: [
            {
              name: '[Created_At]',
              type: 'datetime',
              notNull: false,
            },
          ],
        },
      ],
    });

    const detector = new DataSourceSchemaDetector({ ctx, projectId });

    await expect(detector.detectSchemaChange()).resolves.toBe(false);
    expect(ctx.schemaChangeRepository.createOne).not.toHaveBeenCalled();
    expect(ctx.modelColumnRepository.createOne).not.toHaveBeenCalled();
    expect(ctx.modelColumnRepository.updateOne).not.toHaveBeenCalled();
  });
});
