export function payload() {
  const rows = [];
  for (let i = 0; i < 18; i++) for (const country of ['A', 'B']) for (const channel of ['Direct', 'Search']) {
    const date = new Date(Date.UTC(2023, i, 1)).toISOString().slice(0, 7);
    rows.push([date, country, channel, 10000 + i * 100, 500]);
  }
  return { version: 'revenue-aggregates/1', synthetic: true, currency: 'USD', timezone: 'UTC', amount_scale: 100,
    coverage: { lower: '2023-01', upper_exclusive: '2024-07' }, default_period: { lower: '2024-01', upper_exclusive: '2024-07' },
    columns: ['month', 'country', 'channel', 'gross_units', 'refund_units'], rows,
    definitions: { net: 'gross minus refunds', refund_ratio: 'refund money divided by gross money' } };
}
export function proposal() { return { name: 'plan_revenue_dashboard', args: { status: 'ready', clarification: null,
  objective: 'revenue_health', period_choice: 'latest_complete_quarter', primary_metric: 'net',
  kpis: ['net', 'gross', 'refunds', 'refund_ratio'], dimensions: ['country', 'channel'], primary_dimension: 'country',
  comparison: 'prior_year', analyses: ['revenue_overview', 'monthly_trend'],
  assumptions: ['PRIVATE_REPLAY_CONTEXT: choose the latest complete quarter'], limitations: ['Synthetic history'] } }; }
