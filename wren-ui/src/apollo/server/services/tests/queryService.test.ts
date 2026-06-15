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
