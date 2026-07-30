import { TelemetryEvent } from '../../telemetry/telemetry';
import { DataSourceName } from '../../types';
import { QueryService } from '../queryService';

describe('QueryService', () => {
  const sql = 'selectable statement';
  const dataSource = DataSourceName.POSTGRES;
  const project = { type: dataSource, connectionInfo: {} };
  const manifest = {};

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

  it('passes dry-run requests to ibis and records success telemetry', async () => {
    mockIbisAdaptor.dryRun.mockResolvedValue({
      correlationId: 'correlation-id',
      processTime: 'process-time',
    });

    const res: any = await queryService.preview(sql, {
      project,
      manifest,
      dryRun: true,
    });

    expect(res).toEqual({ correlationId: 'correlation-id' });
    expect(mockIbisAdaptor.dryRun).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        dataSource,
        connectionInfo: project.connectionInfo,
        mdl: manifest,
      }),
    );
    expect(mockTelemetry.records).toEqual([
      {
        event: TelemetryEvent.IBIS_DRY_RUN,
        properties: {
          correlationId: 'correlation-id',
          processTime: 'process-time',
          sql,
          dataSource,
        },
        actionSuccess: true,
      },
    ]);
  });

  it('records dry-run failure telemetry and rethrows the adaptor error', async () => {
    const error = {
      message: 'adaptor failure',
      extensions: {
        other: {
          correlationId: 'correlation-id',
          processTime: 'process-time',
        },
      },
    };
    mockIbisAdaptor.dryRun.mockRejectedValue(error);

    await expect(
      queryService.preview(sql, {
        project,
        manifest,
        dryRun: true,
      }),
    ).rejects.toMatchObject(error);

    expect(mockTelemetry.records).toEqual([
      {
        event: TelemetryEvent.IBIS_DRY_RUN,
        properties: {
          correlationId: 'correlation-id',
          processTime: 'process-time',
          sql,
          dataSource,
          error: 'adaptor failure',
        },
        actionSuccess: false,
        service: undefined,
      },
    ]);
  });

  it('passes query requests to ibis, transforms column metadata, and records success telemetry', async () => {
    mockIbisAdaptor.query.mockResolvedValue({
      data: [['value']],
      columns: ['field'],
      dtypes: { field: 'object' },
      correlationId: 'correlation-id',
      processTime: 'process-time',
    });

    const res = await queryService.preview(sql, {
      project,
      manifest,
      limit: 1,
    });

    expect(res).toEqual({
      columns: [{ name: 'field', type: 'string' }],
      data: [['value']],
      correlationId: 'correlation-id',
      cacheHit: false,
      cacheCreatedAt: undefined,
      cacheOverrodeAt: undefined,
      override: false,
    });
    expect(mockIbisAdaptor.query).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({
        dataSource,
        connectionInfo: project.connectionInfo,
        mdl: manifest,
        limit: 1,
      }),
    );
    expect(mockTelemetry.records).toEqual([
      {
        event: TelemetryEvent.IBIS_QUERY,
        properties: {
          correlationId: 'correlation-id',
          processTime: 'process-time',
          sql,
          dataSource,
        },
        actionSuccess: true,
      },
    ]);
  });

  it('records query failure telemetry and rethrows the adaptor error', async () => {
    const error = {
      message: 'adaptor failure',
      extensions: {
        other: {
          correlationId: 'correlation-id',
          processTime: 'process-time',
        },
      },
    };
    mockIbisAdaptor.query.mockRejectedValue(error);

    await expect(
      queryService.preview(sql, {
        project,
        manifest,
      }),
    ).rejects.toMatchObject(error);

    expect(mockTelemetry.records).toEqual([
      {
        event: TelemetryEvent.IBIS_QUERY,
        properties: {
          correlationId: 'correlation-id',
          processTime: 'process-time',
          sql,
          dataSource,
          error: 'adaptor failure',
        },
        actionSuccess: false,
        service: undefined,
      },
    ]);
  });
});

class MockTelemetry {
  records: any[] = [];
  sendEvent(
    event: TelemetryEvent,
    properties: Record<string, any> = {},
    service: any = undefined,
    actionSuccess: boolean = true,
  ) {
    this.records.push({ event, properties, service, actionSuccess });
  }
}
