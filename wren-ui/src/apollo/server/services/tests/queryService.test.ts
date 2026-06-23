import { TelemetryEvent } from '../../telemetry/telemetry';
import { DataSourceName } from '../../types';
import { QueryService } from '../queryService';

describe('QueryService', () => {
  let mockIbisAdaptor;
  let mockWrenEngineAdaptor;
  let mockTelemetry;
  let queryService;

  beforeEach(() => {
    mockIbisAdaptor = {
      query: jest.fn(),
      dryRun: jest.fn(),
    };
    mockWrenEngineAdaptor = {};
    mockTelemetry = new MockTelemetry();

    queryService = new QueryService({
      ibisAdaptor: mockIbisAdaptor,
      wrenEngineAdaptor: mockWrenEngineAdaptor,
      telemetry: mockTelemetry,
    });
  });

  afterEach(() => {
    mockTelemetry.records = [];
    jest.clearAllMocks();
  });

  it('should return true and send event when previewing via ibis dry run succeeds', async () => {
    mockIbisAdaptor.dryRun.mockResolvedValue({
      correlationId: '123',
      processTime: '1s',
    });

    const res = await queryService.preview('SELECT * FROM test', {
      project: { type: DataSourceName.POSTGRES, connectionInfo: {} },
      manifest: {},
      dryRun: true,
    });

    expect(res).toEqual({ correlationId: '123' });
    expect(mockTelemetry.records).toHaveLength(1);
    expect(mockTelemetry.records[0]).toEqual({
      event: TelemetryEvent.IBIS_DRY_RUN,
      properties: {
        correlationId: '123',
        processTime: '1s',
        sql: 'SELECT * FROM test',
        dataSource: DataSourceName.POSTGRES,
      },
      actionSuccess: true,
    });
  });

  it('should normalize deployed dbo-prefixed table references for non-mssql previews', async () => {
    mockIbisAdaptor.dryRun.mockResolvedValue({
      correlationId: '123',
      processTime: '1s',
    });

    await queryService.preview('SELECT * FROM "dbo_search_queries"', {
      project: {
        type: DataSourceName.POSTGRES,
        connectionInfo: {},
        schema: 'public',
      },
      manifest: {
        schema: 'public',
        models: [
          {
            name: 'dbo_search_queries',
            tableReference: {
              catalog: 'wrenai',
              schema: 'public',
              table: 'dbo_search_queries',
            },
          },
          {
            name: 'dbo_tickets',
            tableReference: {
              catalog: 'wrenai',
              schema: 'dbo',
              table: 'tickets',
            },
          },
        ],
      },
      dryRun: true,
    });

    expect(mockIbisAdaptor.dryRun).toHaveBeenCalledWith(
      'SELECT * FROM "dbo_search_queries"',
      expect.objectContaining({
        mdl: expect.objectContaining({
          models: [
            expect.objectContaining({
              name: 'dbo_search_queries',
              tableReference: {
                catalog: 'wrenai',
                schema: 'public',
                table: 'search_queries',
              },
            }),
            expect.objectContaining({
              name: 'dbo_tickets',
              tableReference: {
                catalog: 'wrenai',
                schema: 'public',
                table: 'tickets',
              },
            }),
          ],
        }),
      }),
    );
  });

  it('should preserve deployed dbo-prefixed table references for mssql previews', async () => {
    mockIbisAdaptor.dryRun.mockResolvedValue({
      correlationId: '123',
      processTime: '1s',
    });

    await queryService.preview('SELECT * FROM "dbo_search_queries"', {
      project: {
        type: DataSourceName.MSSQL,
        connectionInfo: {},
        schema: 'public',
      },
      manifest: {
        schema: 'public',
        models: [
          {
            name: 'dbo_search_queries',
            tableReference: {
              catalog: null,
              schema: 'dbo',
              table: 'search_queries',
            },
          },
        ],
      },
      dryRun: true,
    });

    expect(mockIbisAdaptor.dryRun).toHaveBeenCalledWith(
      'SELECT * FROM "dbo_search_queries"',
      expect.objectContaining({
        mdl: expect.objectContaining({
          models: [
            expect.objectContaining({
              tableReference: {
                catalog: null,
                schema: 'dbo',
                table: 'search_queries',
              },
            }),
          ],
        }),
      }),
    );
  });

  it('should repair old non-mssql deployments that still use dbo refSql', async () => {
    mockIbisAdaptor.dryRun.mockResolvedValue({
      correlationId: '123',
      processTime: '1s',
    });

    await queryService.preview('SELECT * FROM "dbo_search_queries"', {
      project: {
        type: DataSourceName.POSTGRES,
        connectionInfo: {},
        catalog: 'wrenai',
        schema: 'public',
      },
      manifest: {
        catalog: 'wrenai',
        schema: 'public',
        models: [
          {
            name: 'dbo_search_queries',
            refSql: 'SELECT * FROM wrenai.public.dbo_search_queries',
          },
        ],
      },
      dryRun: true,
    });

    const dryRunOptions = mockIbisAdaptor.dryRun.mock.calls[0][1];
    expect(dryRunOptions.mdl.models[0]).toEqual({
      name: 'dbo_search_queries',
      tableReference: {
        catalog: 'wrenai',
        schema: 'public',
        table: 'search_queries',
      },
    });
  });

  it('should normalize non-mssql dbo model names before previewing with ibis', async () => {
    mockIbisAdaptor.dryRun.mockResolvedValue({
      correlationId: '123',
      processTime: '1s',
    });

    await queryService.preview(
      'SELECT created_at FROM dbo_search_queries ORDER BY created_at',
      {
        project: {
          type: DataSourceName.POSTGRES,
          connectionInfo: {},
          schema: 'public',
        },
        manifest: {},
        dryRun: true,
      },
    );

    expect(mockIbisAdaptor.dryRun).toHaveBeenCalledWith(
      'SELECT created_at FROM "dbo_search_queries" ORDER BY created_at',
      expect.any(Object),
    );
  });

  it('should normalize generated datediff calls for non-mssql previews', async () => {
    mockIbisAdaptor.dryRun.mockResolvedValue({
      correlationId: '123',
      processTime: '1s',
    });

    await queryService.preview(
      `SELECT DATEDIFF('day', "dbo_tickets"."created_at", CURRENT_DATE) AS ticket_age FROM "dbo_tickets"`,
      {
        project: {
          type: DataSourceName.POSTGRES,
          connectionInfo: {},
          schema: 'public',
        },
        manifest: {},
        dryRun: true,
      },
    );

    expect(mockIbisAdaptor.dryRun).toHaveBeenCalledWith(
      'SELECT EXTRACT(DAY FROM (CURRENT_DATE - "dbo_tickets"."created_at")) AS ticket_age FROM "dbo_tickets"',
      expect.any(Object),
    );
  });

  it('should send event when previewing via ibis dry run fails', async () => {
    mockIbisAdaptor.dryRun.mockRejectedValue({
      message: 'Error message',
      extensions: {
        other: {
          correlationId: '123',
          processTime: '1s',
        },
      },
    });

    try {
      await queryService.preview('SELECT * FROM test', {
        project: { type: DataSourceName.POSTGRES, connectionInfo: {} },
        manifest: {},
        dryRun: true,
      });
    } catch (e) {
      expect(e.message).toEqual('Error message');
      expect(e.extensions.other.correlationId).toEqual('123');
      expect(e.extensions.other.processTime).toEqual('1s');
    }

    expect(mockTelemetry.records).toHaveLength(1);
    expect(mockTelemetry.records[0]).toEqual({
      event: TelemetryEvent.IBIS_DRY_RUN,
      properties: {
        correlationId: '123',
        processTime: '1s',
        sql: 'SELECT * FROM test',
        dataSource: DataSourceName.POSTGRES,
        error: 'Error message',
      },
      actionSuccess: false,
      service: undefined,
    });
  });

  it('should return data and send event when previewing via ibis query succeeds', async () => {
    mockIbisAdaptor.query.mockResolvedValue({
      data: [],
      columns: [],
      dtypes: [],
      correlationId: '123',
      processTime: '1s',
    });

    const res = await queryService.preview('SELECT * FROM test', {
      project: { type: DataSourceName.POSTGRES, connectionInfo: {} },
      manifest: {},
      limit: 10,
    });

    expect(res.data).toEqual([]);
    expect(mockTelemetry.records).toHaveLength(1);
    expect(mockTelemetry.records[0]).toEqual({
      event: TelemetryEvent.IBIS_QUERY,
      properties: {
        correlationId: '123',
        processTime: '1s',
        sql: 'SELECT * FROM test',
        dataSource: DataSourceName.POSTGRES,
      },
      actionSuccess: true,
    });
  });

  it('should send event when previewing via ibis query fails', async () => {
    mockIbisAdaptor.query.mockRejectedValue({
      message: 'Error message',
      extensions: {
        other: {
          correlationId: '123',
          processTime: '1s',
        },
      },
    });

    await expect(
      queryService.preview('SELECT * FROM test', {
        project: { type: DataSourceName.POSTGRES, connectionInfo: {} },
        manifest: {},
      }),
    ).rejects.toMatchObject({
      message: 'Error message',
      extensions: {
        other: {
          correlationId: '123',
          processTime: '1s',
        },
      },
    });

    expect(mockTelemetry.records).toHaveLength(1);
    expect(mockTelemetry.records[0]).toEqual({
      event: TelemetryEvent.IBIS_QUERY,
      properties: {
        correlationId: '123',
        processTime: '1s',
        sql: 'SELECT * FROM test',
        dataSource: DataSourceName.POSTGRES,
        error: 'Error message',
      },
      actionSuccess: false,
      service: undefined,
    });
  });

  it('should reject sql that references tables outside the active manifest before ibis dry run', async () => {
    await expect(
      queryService.preview('SELECT * FROM dbo_failure_patterns', {
        project: { type: DataSourceName.POSTGRES, connectionInfo: {} },
        manifest: {
          models: [
            {
              name: 'dbo_tblSales',
              tableReference: { table: 'dbo_tblSales' },
            },
          ],
        },
        dryRun: true,
      }),
    ).rejects.toThrow(
      'Generated SQL references table(s) not present in the active datasource metadata: dbo_failure_patterns',
    );

    expect(mockIbisAdaptor.dryRun).not.toHaveBeenCalled();
  });

  it('should reject sql that references columns outside the active manifest before ibis dry run', async () => {
    await expect(
      queryService.preview('SELECT "orders"."OTD_Date" FROM "orders"', {
        project: { type: DataSourceName.POSTGRES, connectionInfo: {} },
        manifest: {
          models: [
            {
              name: 'orders',
              tableReference: { table: 'orders' },
              columns: [
                { name: 'order_date', type: 'timestamp', isCalculated: false },
                { name: 'quantity', type: 'integer', isCalculated: false },
              ],
            },
          ],
        },
        dryRun: true,
      }),
    ).rejects.toThrow(
      'Generated SQL references column(s) or expressions not valid for the active datasource metadata: orders.OTD_Date',
    );

    expect(mockIbisAdaptor.dryRun).not.toHaveBeenCalled();
  });

  it('should reject unqualified projected columns outside a single active manifest table', async () => {
    await expect(
      queryService.preview('SELECT tools_required FROM "knowledge_articles"', {
        project: { type: DataSourceName.POSTGRES, connectionInfo: {} },
        manifest: {
          models: [
            {
              name: 'knowledge_articles',
              tableReference: { table: 'knowledge_articles' },
              columns: [
                { name: 'id', type: 'integer', isCalculated: false },
                { name: 'content', type: 'string', isCalculated: false },
              ],
            },
          ],
        },
        dryRun: true,
      }),
    ).rejects.toThrow(
      'Generated SQL references column(s) or expressions not valid for the active datasource metadata: tools_required',
    );

    expect(mockIbisAdaptor.dryRun).not.toHaveBeenCalled();
  });

  it('should reject numeric aggregates on non-numeric manifest columns before ibis planning', async () => {
    await expect(
      queryService.preview('SELECT AVG("orders"."quantity") FROM "orders"', {
        project: { type: DataSourceName.POSTGRES, connectionInfo: {} },
        manifest: {
          models: [
            {
              name: 'orders',
              tableReference: { table: 'orders' },
              columns: [
                { name: 'quantity', type: 'string', isCalculated: false },
              ],
            },
          ],
        },
        dryRun: true,
      }),
    ).rejects.toThrow(
      'Generated SQL references column(s) or expressions not valid for the active datasource metadata: AVG(orders.quantity) uses a non-numeric column',
    );

    expect(mockIbisAdaptor.dryRun).not.toHaveBeenCalled();
  });

  it('should allow numeric aggregates on numeric manifest columns before ibis planning', async () => {
    mockIbisAdaptor.dryRun.mockResolvedValue({
      correlationId: '123',
      processTime: '1s',
    });

    await queryService.preview('SELECT AVG("orders"."quantity") FROM "orders"', {
      project: { type: DataSourceName.POSTGRES, connectionInfo: {} },
      manifest: {
        models: [
          {
            name: 'orders',
            tableReference: { table: 'orders' },
            columns: [
              { name: 'quantity', type: 'integer', isCalculated: false },
            ],
          },
        ],
      },
      dryRun: true,
    });

    expect(mockIbisAdaptor.dryRun).toHaveBeenCalledTimes(1);
  });

  it('should allow active manifest table references before ibis dry run', async () => {
    mockIbisAdaptor.dryRun.mockResolvedValue({
      correlationId: '123',
      processTime: '1s',
    });

    await queryService.preview('SELECT * FROM wrenai.public.dbo_tblSales', {
      project: { type: DataSourceName.POSTGRES, connectionInfo: {} },
      manifest: {
        models: [
          {
            name: 'dbo_tblSales',
            tableReference: { table: 'dbo_tblSales' },
          },
        ],
      },
      dryRun: true,
    });

    expect(mockIbisAdaptor.dryRun).toHaveBeenCalledTimes(1);
  });
});

class MockTelemetry {
  records: any[] = [];
  sendEvent(
    event: TelemetryEvent,
    properties: Record<string, any> = {},
    service: any,
    actionSuccess: boolean = true,
  ) {
    this.records.push({ event, properties, service, actionSuccess });
  }
}
