import { ChartStatus, ChartType } from '@server/models/adaptor';
import {
  applyDeterministicChartAdjustment,
  canonicalizeChartSchema,
  shapeChartPreviewData,
} from './chartSpecRuntime';

describe('chartSpecRuntime', () => {
  it('canonicalizes raw chart schema into a renderable spec with version metadata', () => {
    const result = canonicalizeChartSchema({
      mark: 'line',
      encoding: {
        x: { field: 'month', type: 'temporal' },
        y: { field: 'sales', type: 'quantitative' },
      },
    });

    expect(result.validationErrors).toEqual([]);
    expect(result.canonicalizationVersion).toBe('chart-canonical-v1');
    expect(result.canonicalChartSchema).toMatchObject({
      mark: expect.objectContaining({
        type: 'line',
        point: true,
        tooltip: true,
      }),
      autosize: { type: 'fit', contains: 'padding' },
      width: 'container',
      height: 'container',
      encoding: expect.objectContaining({
        x: expect.objectContaining({ field: 'month' }),
        y: expect.objectContaining({ field: 'sales' }),
      }),
    });
    expect(result.renderHints).toEqual(
      expect.objectContaining({ preferredRenderer: 'canvas' }),
    );
  });

  it('adds color fallback and hover defaults for nominal bar specs', () => {
    const result = canonicalizeChartSchema({
      mark: 'bar',
      encoding: {
        x: { field: 'region', type: 'nominal', title: 'Region' },
        y: { field: 'sales', type: 'quantitative', title: 'Sales' },
      },
    });

    expect(result.validationErrors).toEqual([]);
    expect(result.canonicalChartSchema).toMatchObject({
      mark: expect.objectContaining({ type: 'bar' }),
      encoding: expect.objectContaining({
        color: expect.objectContaining({
          field: 'region',
          type: 'nominal',
          title: 'Region',
          condition: expect.objectContaining({
            param: 'hover',
            field: 'region',
          }),
        }),
        opacity: expect.objectContaining({
          condition: expect.objectContaining({
            param: 'hover',
            value: 1,
          }),
          value: 0.3,
        }),
      }),
      params: [
        expect.objectContaining({
          name: 'hover',
          select: expect.objectContaining({
            fields: ['region'],
          }),
        }),
      ],
    });
  });

  it('canonicalizes pie charts with donut defaults and validation', () => {
    const result = canonicalizeChartSchema({
      mark: 'arc',
      encoding: {
        color: { field: 'segment', type: 'nominal' },
        theta: { field: 'sales', type: 'quantitative' },
      },
    });

    expect(result.validationErrors).toEqual([]);
    expect(result.canonicalChartSchema).toMatchObject({
      mark: expect.objectContaining({
        type: 'arc',
        innerRadius: 60,
      }),
      encoding: expect.objectContaining({
        color: expect.objectContaining({ field: 'segment' }),
        theta: expect.objectContaining({ field: 'sales' }),
      }),
    });
  });

  it('reports stronger validation errors for unsupported/invalid chart specs', () => {
    const result = canonicalizeChartSchema({
      mark: 'circle',
      encoding: {
        x: { field: 'region' },
        y: { field: 'segment', type: 'nominal' },
      },
    });

    expect(result.validationErrors).toEqual(
      expect.arrayContaining([
        'Unsupported chart mark type: circle',
        'Encoding channel x is missing type',
      ]),
    );
  });

  it('applies deterministic grouped bar adjustments without AI-only fields', () => {
    const result = applyDeterministicChartAdjustment(
      {
        status: ChartStatus.FINISHED,
        chartType: 'BAR',
        chartSchema: {
          mark: 'bar',
          encoding: {
            x: { field: 'region', type: 'nominal', title: 'Region' },
            y: { field: 'sales', type: 'quantitative', title: 'Sales' },
            color: { field: 'segment', type: 'nominal', title: 'Segment' },
          },
        },
      },
      {
        chartType: ChartType.GROUPED_BAR,
        xAxis: 'region',
        yAxis: 'sales',
        xOffset: 'segment',
      },
    );

    expect(result.chartType).toBe('GROUPED_BAR');
    expect(result.rawChartSchema).toEqual(
      expect.objectContaining({
        mark: 'bar',
        encoding: expect.objectContaining({
          xOffset: expect.objectContaining({ field: 'segment' }),
        }),
      }),
    );
    expect(result.chartSchema).toEqual(
      expect.objectContaining({
        mark: expect.objectContaining({ type: 'bar' }),
        encoding: expect.objectContaining({
          xOffset: expect.objectContaining({ field: 'segment' }),
          color: expect.objectContaining({ field: 'segment' }),
        }),
      }),
    );
  });

  it('applies server-side top-n shaping for high-cardinality categorical charts', () => {
    const result = shapeChartPreviewData({
      chartDetail: {
        chartSchema: {
          mark: 'bar',
          encoding: {
            x: { field: 'category', type: 'nominal' },
            y: { field: 'sales', type: 'quantitative' },
          },
        },
      },
      previewData: {
        columns: [
          { name: 'category', type: 'string' },
          { name: 'sales', type: 'number' },
        ],
        data: Array.from({ length: 30 }, (_, index) => [
          `c-${index}`,
          100 - index,
        ]),
      } as any,
    });

    expect(result.previewData.data.length).toBe(26);
    expect(result.chartDataProfile).toMatchObject({
      sourceRowCount: 30,
      resultRowCount: 26,
      appliedShaping: expect.arrayContaining([
        expect.objectContaining({ type: 'top_n', value: 25 }),
        expect.objectContaining({ type: 'other_bucket' }),
      ]),
    });
    expect(result.renderHints).toMatchObject({
      categoryCount: 30,
      isLargeCategory: true,
      suggestedTopN: 25,
    });
  });

  it('applies server-side downsample for dense line charts', () => {
    const result = shapeChartPreviewData({
      chartDetail: {
        chartSchema: {
          mark: 'line',
          encoding: {
            x: { field: 'date', type: 'temporal' },
            y: { field: 'sales', type: 'quantitative' },
          },
        },
      },
      previewData: {
        columns: [
          { name: 'date', type: 'date' },
          { name: 'sales', type: 'number' },
        ],
        data: Array.from({ length: 240 }, (_, index) => [
          `2026-01-${String((index % 30) + 1).padStart(2, '0')}`,
          index,
        ]),
      } as any,
    });

    expect(result.previewData.data.length).toBe(120);
    expect(result.chartDataProfile).toMatchObject({
      sourceRowCount: 240,
      resultRowCount: 120,
      appliedShaping: [
        expect.objectContaining({ type: 'time_downsample', value: 120 }),
      ],
    });
    expect(result.renderHints).toMatchObject({
      preferredRenderer: 'canvas',
      isDenseSeries: true,
    });
  });

  it('sorts temporal rows before line chart downsample', () => {
    const result = shapeChartPreviewData({
      chartDetail: {
        chartSchema: {
          mark: 'line',
          encoding: {
            x: { field: 'date', type: 'temporal' },
            y: { field: 'sales', type: 'quantitative' },
          },
        },
      },
      previewData: {
        columns: [
          { name: 'date', type: 'date' },
          { name: 'sales', type: 'number' },
        ],
        data: Array.from({ length: 140 }, (_, index) => [
          new Date(Date.UTC(2026, 0, 140 - index)).toISOString(),
          index,
        ]),
      } as any,
    });

    const [firstDate] = result.previewData.data[0] as string[];
    const [lastDate] = result.previewData.data[
      result.previewData.data.length - 1
    ] as string[];
    expect(firstDate <= lastDate).toBe(true);
    expect(result.chartDataProfile).toMatchObject({
      appliedShaping: [expect.objectContaining({ type: 'time_downsample' })],
    });
  });
});
