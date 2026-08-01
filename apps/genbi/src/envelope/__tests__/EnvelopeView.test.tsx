import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@/app/theme/ThemeProvider';
import { EnvelopeView } from '@/envelope';
import type { RenderEnvelope } from '@/envelope/types';
import {
  answerQueryEnvelope,
  dashboardEnvelope,
  explainChangeEnvelope,
  forecastEnvelope,
  withUnknownBlockEnvelope,
} from '@/fixtures/envelopes';

// ECharts needs a real canvas; stub it so chart-bearing envelopes render in jsdom.
vi.mock('echarts', () => ({
  init: () => ({ setOption() {}, resize() {}, dispose() {} }),
}));

function renderEnvelope(envelope: RenderEnvelope) {
  return render(
    <ThemeProvider>
      <EnvelopeView envelope={envelope} />
    </ThemeProvider>,
  );
}

describe('EnvelopeView', () => {
  it('renders a table block with its columns and cells', () => {
    renderEnvelope(answerQueryEnvelope);
    // AntD Table may render the column title in more than one node (measure row).
    expect(screen.getAllByText('Customer').length).toBeGreaterThan(0);
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
  });

  it('aligns table cells to columns positionally (array rows, not objects)', () => {
    const envelope: RenderEnvelope = {
      verified: true,
      blocks: [{ type: 'table', columns: ['A', 'B', 'C'], rows: [['a1', 'b1', 'c1']] }],
    };
    renderEnvelope(envelope);
    expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).toEqual([
      'A',
      'B',
      'C',
    ]);
    // Body cells appear in the same positional order as the row array.
    expect(screen.getAllByRole('cell').map((c) => c.textContent)).toEqual(['a1', 'b1', 'c1']);
  });

  it('renders table cells for object rows keyed by column name', () => {
    // Some agent outputs emit rows as objects keyed by column name rather
    // than positional arrays (e.g. Mode B `wren -q -o json`).
    const envelope: RenderEnvelope = {
      verified: true,
      blocks: [
        {
          type: 'table',
          columns: ['period', 'transaction_count', 'avg_price'],
          rows: [
            { period: '2024S3', transaction_count: 101885, avg_price: 1285089.98 },
          ],
        },
      ],
    };
    renderEnvelope(envelope);
    expect(screen.getAllByRole('columnheader').map((c) => c.textContent)).toEqual([
      'period',
      'transaction_count',
      'avg_price',
    ]);
    expect(screen.getAllByRole('cell').map((c) => c.textContent)).toEqual([
      '2024S3',
      '101885',
      '1285089.98',
    ]);
  });

  it('renders a definition block with SQL, sources and filters', () => {
    renderEnvelope(answerQueryEnvelope);
    expect(screen.getByText('How this was derived')).toBeInTheDocument();
    expect(screen.getByText(/SELECT customer/)).toBeInTheDocument();
    expect(screen.getByText('orders')).toBeInTheDocument();
    expect(screen.getByText('order_date >= current quarter')).toBeInTheDocument();
  });

  it('renders kpi_card blocks with labels', () => {
    renderEnvelope(dashboardEnvelope);
    expect(screen.getByText('Revenue (MTD)')).toBeInTheDocument();
    expect(screen.getByText('New customers')).toBeInTheDocument();
  });

  it('renders a narrative block with title and text', () => {
    renderEnvelope(explainChangeEnvelope);
    expect(screen.getByText('Why did revenue rise in July?')).toBeInTheDocument();
    expect(screen.getByText(/July revenue grew/)).toBeInTheDocument();
  });

  it('shows Verified for a verified envelope', () => {
    renderEnvelope(answerQueryEnvelope);
    expect(screen.getByText('Verified')).toBeInTheDocument();
  });

  it('shows Estimate (not Verified) for an estimate envelope', () => {
    renderEnvelope(forecastEnvelope);
    expect(screen.getByText('Estimate')).toBeInTheDocument();
    expect(screen.getByText(/projection · basis verified/)).toBeInTheDocument();
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
  });

  it('degrades unknown block types gracefully without dropping sibling blocks', () => {
    renderEnvelope(withUnknownBlockEnvelope);
    expect(screen.getByText(/Unsupported block: "timeline"/)).toBeInTheDocument();
    // The sibling narrative still rendered.
    expect(screen.getByText(/does not render yet/)).toBeInTheDocument();
  });

  it('renders a bare table block (no columns/rows) as an empty note, not a crash', () => {
    // A live agent can emit a verified answer whose table block carries no
    // columns/rows (the data is in the summary). This must not throw.
    const envelope = {
      verified: true,
      summary: 'The number of customers is 8,000.',
      blocks: [{ type: 'table' }],
    } as unknown as RenderEnvelope;
    renderEnvelope(envelope);
    expect(screen.getByText('The number of customers is 8,000.')).toBeInTheDocument();
    expect(screen.getByText('No table data')).toBeInTheDocument();
  });
});
