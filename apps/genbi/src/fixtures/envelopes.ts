import type { RenderEnvelope } from '@/envelope/types';

/**
 * Sample render envelopes covering each block type and answer state. Shapes
 * mirror the genbi-default agent output_schemas (answer_query = table,
 * generate_dashboard = kpi/chart/table, explain_change = narrative). Data is
 * synthetic. These drive the UI in Phase 1a with no backend.
 */

/** answer_query: a verified table plus how it was derived. */
export const answerQueryEnvelope: RenderEnvelope = {
  verified: true,
  summary: 'Top 5 customers by revenue this quarter.',
  blocks: [
    {
      type: 'table',
      columns: ['Customer', 'Revenue', 'Orders'],
      rows: [
        ['Acme Corp', 128400, 42],
        ['Globex', 98200, 31],
        ['Initech', 76500, 27],
        ['Umbrella', 64100, 19],
        ['Soylent', 51800, 22],
      ],
    },
    {
      type: 'definition',
      sql: 'SELECT customer, SUM(amount) AS revenue, COUNT(*) AS orders\nFROM orders\nWHERE order_date >= DATE_TRUNC(\'quarter\', CURRENT_DATE)\nGROUP BY customer\nORDER BY revenue DESC\nLIMIT 5',
      source_tables: ['orders', 'customers'],
      filters: ['order_date >= current quarter'],
    },
  ],
};

/** generate_dashboard: KPIs + chart + table. */
export const dashboardEnvelope: RenderEnvelope = {
  verified: true,
  summary: 'Revenue overview for the last 6 months.',
  blocks: [
    { type: 'kpi_card', label: 'Revenue (MTD)', value: '$418.9k', delta: 12.4, unit: '%' },
    { type: 'kpi_card', label: 'New customers', value: 137, delta: 8 },
    { type: 'kpi_card', label: 'Churn', value: '2.1%', delta: -0.3, unit: 'pp' },
    {
      type: 'chart',
      chart_type: 'bar',
      x: 'month',
      series: ['revenue'],
      rows: [
        { month: 'Feb', revenue: 302000 },
        { month: 'Mar', revenue: 331000 },
        { month: 'Apr', revenue: 358000 },
        { month: 'May', revenue: 372000 },
        { month: 'Jun', revenue: 401000 },
        { month: 'Jul', revenue: 419000 },
      ],
    },
    {
      type: 'table',
      columns: ['Plan', 'MRR', 'Accounts'],
      rows: [
        ['Enterprise', 240000, 48],
        ['Team', 132000, 210],
        ['Starter', 47000, 940],
      ],
    },
  ],
};

/** explain_change: a narrative answer. */
export const explainChangeEnvelope: RenderEnvelope = {
  verified: true,
  blocks: [
    {
      type: 'narrative',
      title: 'Why did revenue rise in July?',
      text: 'July revenue grew 4.5% over June, driven mainly by the Enterprise plan.\n\nTwo new Enterprise accounts (Acme Corp, Globex) contributed $38k of the $18k net increase, partly offset by one Team-plan downgrade.',
    },
  ],
};

/** A forecast — honestly degraded to an estimate rather than a green Verified. */
export const forecastEnvelope: RenderEnvelope = {
  estimate: true,
  verified: false,
  summary: 'Projected revenue for the next 3 months (linear trend on verified history).',
  blocks: [
    {
      type: 'chart',
      chart_type: 'line',
      x: 'month',
      series: ['projected'],
      rows: [
        { month: 'Aug', projected: 436000 },
        { month: 'Sep', projected: 452000 },
        { month: 'Oct', projected: 469000 },
      ],
    },
  ],
};

/** Demonstrates graceful degradation of an unsupported block type. */
export const withUnknownBlockEnvelope: RenderEnvelope = {
  verified: true,
  blocks: [
    { type: 'narrative', text: 'This answer includes a block this UI version does not render yet.' },
    { type: 'timeline', events: [{ at: '2026-07-01', label: 'launch' }] } as never,
  ],
};

export const fixtureEnvelopes = {
  answerQuery: answerQueryEnvelope,
  dashboard: dashboardEnvelope,
  explainChange: explainChangeEnvelope,
  forecast: forecastEnvelope,
  withUnknownBlock: withUnknownBlockEnvelope,
};
