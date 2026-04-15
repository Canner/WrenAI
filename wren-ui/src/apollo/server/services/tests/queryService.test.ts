import { TelemetryEvent } from '../../telemetry/telemetry';
import { DataSourceName } from '../../types';
import { QueryService } from '../queryService';

describe('QueryService', () => {
  let mockIbisAdaptor: any;
  let mockWrenEngineAdaptor: any;
  let mockTelemetry: any;
  let queryService: any;

  beforeEach(() => {
    mockIbisAdaptor = {
      query: jest.fn(),
      dryRun: jest.fn(),
    };
    mockWrenEngineAdaptor = {
      prepareDuckDB: jest.fn().mockResolvedValue(undefined),
      patchConfig: jest.fn().mockResolvedValue(undefined),
      dryRun: jest.fn().mockResolvedValue([]),
      previewData: jest.fn().mockResolvedValue({ data: [], columns: [] }),
    };
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
    } catch (e: any) {
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

  it('prepares duckdb runtime before dryRun preview', async () => {
    await queryService.preview('SELECT * FROM test', {
      project: {
        type: DataSourceName.DUCKDB,
        connectionInfo: {
          initSql: 'CREATE TABLE test AS SELECT 1 AS id;',
          extensions: ['httpfs'],
          configurations: { timezone: 'UTC' },
        },
      },
      manifest: {},
      dryRun: true,
    });

    expect(mockWrenEngineAdaptor.prepareDuckDB).toHaveBeenCalledWith({
      initSql: 'INSTALL httpfs;\nCREATE TABLE test AS SELECT 1 AS id;',
      sessionProps: { timezone: 'UTC' },
    });
    expect(mockWrenEngineAdaptor.patchConfig).toHaveBeenCalledWith({
      'wren.datasource.type': 'duckdb',
    });
    expect(mockWrenEngineAdaptor.dryRun).toHaveBeenCalledWith(
      'SELECT * FROM test',
      {
        manifest: {},
        limit: undefined,
      },
    );
  });

  it('reuses duckdb runtime when connection settings stay the same', async () => {
    const project = {
      type: DataSourceName.DUCKDB,
      connectionInfo: {
        initSql: 'CREATE TABLE test AS SELECT 1 AS id;',
        extensions: [],
        configurations: {},
      },
    };

    await queryService.preview('SELECT * FROM test', {
      project,
      manifest: {},
      dryRun: true,
    });
    await queryService.preview('SELECT * FROM test LIMIT 10', {
      project,
      manifest: {},
      dryRun: true,
    });

    expect(mockWrenEngineAdaptor.prepareDuckDB).toHaveBeenCalledTimes(1);
    expect(mockWrenEngineAdaptor.patchConfig).toHaveBeenCalledTimes(1);
    expect(mockWrenEngineAdaptor.dryRun).toHaveBeenCalledTimes(2);
  });

  it('re-prepares duckdb runtime after switching to a different initSql', async () => {
    await queryService.preview('SELECT 1', {
      project: {
        type: DataSourceName.DUCKDB,
        connectionInfo: {
          initSql: 'CREATE TABLE test_a AS SELECT 1 AS id;',
          extensions: [],
          configurations: {},
        },
      },
      manifest: {},
      dryRun: true,
    });
    await queryService.preview('SELECT 2', {
      project: {
        type: DataSourceName.DUCKDB,
        connectionInfo: {
          initSql: 'CREATE TABLE test_b AS SELECT 2 AS id;',
          extensions: [],
          configurations: {},
        },
      },
      manifest: {},
      dryRun: true,
    });

    expect(mockWrenEngineAdaptor.prepareDuckDB).toHaveBeenCalledTimes(2);
    expect(mockWrenEngineAdaptor.patchConfig).toHaveBeenCalledTimes(2);
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
