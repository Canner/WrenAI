import { prepareChartSpecForRender, resolvePreferredRenderer } from './render';

describe('chart render helpers', () => {
  const values = [
    { month: '2026-01-01 00:00:00 UTC+00:00', sales: 100, category: 'A' },
    { month: '2026-01-02 00:00:00 UTC+00:00', sales: 80, category: 'B' },
  ];

  it('returns null when category cardinality exceeds limit without filter opt-in', () => {
    const spec = {
      mark: 'bar',
      encoding: {
        x: { field: 'category', type: 'nominal' },
        y: { field: 'sales', type: 'quantitative' },
      },
    } as any;

    const result = prepareChartSpecForRender({
      spec,
      values: Array.from({ length: 30 }, (_, index) => ({
        category: `c-${index}`,
        sales: index,
      })),
      options: {
        categoriesLimit: 25,
      },
    });

    expect(result).toBeNull();
  });

  it('does not re-filter server-shaped categorical values', () => {
    const result = prepareChartSpecForRender({
      spec: {
        mark: 'bar',
        encoding: {
          x: { field: 'category', type: 'nominal' },
          y: { field: 'sales', type: 'quantitative' },
        },
      } as any,
      values: Array.from({ length: 26 }, (_, index) => ({
        category: index === 25 ? 'Other' : `c-${index}`,
        sales: 100 - index,
      })),
      options: {
        categoriesLimit: 25,
        serverShaped: true,
      },
    }) as any;

    expect(result).not.toBeNull();
    expect(result.data.values).toHaveLength(26);
    expect(result.data.values[result.data.values.length - 1]).toMatchObject({
      category: 'Other',
    });
  });

  it('applies lightweight display patches without legacy normalization', () => {
    const spec = {
      mark: { type: 'line' },
      encoding: {
        x: { field: 'month', type: 'temporal' },
        y: { field: 'sales', type: 'quantitative' },
        color: { field: 'category', type: 'nominal' },
      },
      autosize: { type: 'fit', contains: 'padding' },
    } as any;

    const result = prepareChartSpecForRender({
      spec,
      values,
      options: {
        hideLegend: true,
        hideTitle: true,
      },
    });

    expect(result).toMatchObject({
      title: null,
      data: {
        values: [
          expect.objectContaining({ month: '2026-01-01 00:00:00' }),
          expect.objectContaining({ month: '2026-01-02 00:00:00' }),
        ],
      },
      encoding: {
        color: expect.objectContaining({ legend: null }),
      },
    });
  });

  it('renders legacy non-canonical bar specs without handler fallback-only fields', () => {
    const result = prepareChartSpecForRender({
      spec: {
        mark: 'bar',
        encoding: {
          x: { field: 'category', type: 'nominal', title: 'Category' },
          y: { field: 'sales', type: 'quantitative', title: 'Sales' },
        },
      } as any,
      values,
    }) as any;

    expect(result).toMatchObject({
      autosize: { type: 'fit', contains: 'padding' },
      width: 'container',
      height: 'container',
      encoding: {
        color: expect.objectContaining({
          field: 'category',
          type: 'nominal',
          title: 'Category',
        }),
        opacity: expect.objectContaining({
          condition: expect.objectContaining({
            param: 'hover',
          }),
        }),
      },
      params: [
        expect.objectContaining({
          name: 'hover',
          select: expect.objectContaining({
            fields: ['category'],
          }),
        }),
      ],
    });
  });

  it('enriches canonical string marks without legacy fallback', () => {
    const result = prepareChartSpecForRender({
      spec: {
        mark: 'arc',
        encoding: {
          color: { field: 'category', type: 'nominal' },
          theta: { field: 'sales', type: 'quantitative' },
        },
        autosize: { type: 'fit', contains: 'padding' },
      } as any,
      values,
      options: {
        donutInner: 88,
      },
    }) as any;

    expect(result.mark).toMatchObject({
      type: 'arc',
      innerRadius: 88,
    });
  });

  it('prefers canvas for dense pinned line charts', () => {
    const spec = {
      mark: { type: 'line' },
    } as any;
    const renderer = resolvePreferredRenderer({
      spec,
      values: Array.from({ length: 150 }, (_, index) => ({ x: index })),
      isPinned: true,
    });

    expect(renderer).toBe('canvas');
  });
});
