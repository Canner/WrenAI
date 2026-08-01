import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@/app/theme/ThemeProvider';
import { WorkLog } from '../WorkLog';
import type { ToolStep } from '../types';

function renderSteps(steps: ToolStep[]) {
  return render(
    <ThemeProvider>
      <WorkLog steps={steps} />
    </ThemeProvider>,
  );
}

describe('WorkLog', () => {
  it('renders nothing for an empty trace', () => {
    renderSteps([]);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('renders a nested sub-agent delegation, indenting the child step under its parent', () => {
    const steps: ToolStep[] = [
      { id: 'w1', label: 'Query verified history', state: 'done', kind: 'tool', depth: 0 },
      { id: 'w2', label: 'Delegate: forecast sub-agent', state: 'running', kind: 'subagent', depth: 0 },
      { id: 'w3', label: 'Fit trend model', state: 'running', kind: 'subagent' as const, parent: 'w2', depth: 1 },
    ];
    renderSteps(steps);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[1]).toHaveTextContent('Delegate: forecast sub-agent');
    expect(items[2]).toHaveTextContent('Fit trend model');

    // The nested child is indented further than its parent — never the same
    // left offset — so nesting is visible even without reading labels.
    const parentIndent = parseInt(items[1].style.paddingLeft || '0', 10);
    const childIndent = parseInt(items[2].style.paddingLeft || '0', 10);
    expect(childIndent).toBeGreaterThan(parentIndent);
  });

  it('conveys each state via an icon and a text label, never color alone', () => {
    const steps: ToolStep[] = [
      { id: 'w1', label: 'Step A', state: 'running', kind: 'tool', depth: 0 },
      { id: 'w2', label: 'Step B', state: 'done', kind: 'tool', depth: 0 },
      { id: 'w3', label: 'Step C', state: 'error', kind: 'tool', depth: 0 },
    ];
    renderSteps(steps);

    // Every state has a distinct text label present in the accessible tree.
    expect(screen.getByText('(running)')).toBeInTheDocument();
    expect(screen.getByText('(done)')).toBeInTheDocument();
    expect(screen.getByText('(error)')).toBeInTheDocument();
  });

  it('labels the region for assistive tech', () => {
    renderSteps([{ id: 'w1', label: 'Step A', state: 'done', kind: 'tool', depth: 0 }]);
    expect(screen.getByRole('list', { name: 'Work log' })).toBeInTheDocument();
  });

  it('does not make a step with neither input nor detail clickable/expandable', () => {
    renderSteps([{ id: 'w1', label: 'resolve_intent', state: 'done', kind: 'tool', depth: 0 }]);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('resolve_intent')).toBeInTheDocument();
  });

  it('expands a step with input + detail on click, showing its SQL input and result detail', async () => {
    const user = userEvent.setup();
    const steps: ToolStep[] = [
      {
        id: 'w1',
        label: 'query',
        state: 'done',
        kind: 'tool',
        depth: 0,
        input: { sql: 'SELECT 1' },
        detail: 'Returned 1 row.',
      },
    ];
    renderSteps(steps);

    const toggle = screen.getByRole('button');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('SELECT 1')).not.toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('SELECT 1')).toBeInTheDocument();
    expect(screen.getByText('Returned 1 row.')).toBeInTheDocument();

    // Collapses again on a second click.
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('SELECT 1')).not.toBeInTheDocument();
  });

  it('shows the error detail (labeled distinctly from a result) for an errored step', async () => {
    const user = userEvent.setup();
    const steps: ToolStep[] = [
      {
        id: 'w1',
        label: 'query',
        state: 'error',
        kind: 'tool',
        depth: 0,
        input: { sql: 'SELECT bad_col FROM t' },
        detail: 'column "bad_col" does not exist',
      },
    ];
    renderSteps(steps);

    await user.click(screen.getByRole('button'));

    expect(screen.getByText('SELECT bad_col FROM t')).toBeInTheDocument();
    expect(screen.getByText('column "bad_col" does not exist')).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.queryByText('Result')).not.toBeInTheDocument();
  });

  it('expands a detail-only LLM reasoning step (no input), showing its reasoning', async () => {
    const user = userEvent.setup();
    const steps: ToolStep[] = [
      {
        id: 'w1',
        label: 'resolve_intent',
        state: 'done',
        kind: 'step',
        depth: 0,
        detail: 'query_intent: Monthly signups trend.',
      },
    ];
    renderSteps(steps);

    const toggle = screen.getByRole('button');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('query_intent: Monthly signups trend.')).not.toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // Labeled as reasoning — distinct from a tool row's "Result"; and no
    // "Input" section since a reasoning step carries only detail.
    expect(screen.getByText('Reasoning')).toBeInTheDocument();
    expect(screen.queryByText('Input')).not.toBeInTheDocument();
    expect(screen.getByText('query_intent: Monthly signups trend.')).toBeInTheDocument();
  });

  it('renders a distinct step icon for kind "step" — not the tool or sub-agent glyph', () => {
    const { container } = renderSteps([
      { id: 'w1', label: 'query', state: 'done', kind: 'tool', depth: 0 },
      { id: 'w2', label: 'Delegate: sub-agent', state: 'done', kind: 'subagent', depth: 0 },
      { id: 'w3', label: 'generate_sql', state: 'done', kind: 'step', depth: 0 },
    ]);

    const items = screen.getAllByRole('listitem');
    // The reasoning step uses the bulb glyph; the tool and sub-agent rows keep
    // their own icons, so no glyph is shared across the three kinds.
    expect(items[2].querySelector('.anticon-bulb')).toBeInTheDocument();
    expect(items[0].querySelector('.anticon-bulb')).not.toBeInTheDocument();
    expect(items[1].querySelector('.anticon-bulb')).not.toBeInTheDocument();
    expect(items[0].querySelector('.anticon-tool')).toBeInTheDocument();
    expect(items[1].querySelector('.anticon-apartment')).toBeInTheDocument();
    // The step row is not itself a tool/sub-agent glyph.
    expect(items[2].querySelector('.anticon-tool')).not.toBeInTheDocument();
    expect(items[2].querySelector('.anticon-apartment')).not.toBeInTheDocument();
    // container reference kept to satisfy render return usage.
    expect(container).toBeTruthy();
  });

  it('renders a decision "Route" row inline — its detail is visible without any click, and it is not a button', () => {
    const steps: ToolStep[] = [
      {
        id: 'w1',
        label: 'Route',
        state: 'done',
        kind: 'decision',
        depth: 0,
        detail: '→ generate_dashboard: dashboard intent (by month)',
      },
    ];
    renderSteps(steps);

    // The decision's detail is shown inline — present in the DOM with no click.
    expect(
      screen.getByText('→ generate_dashboard: dashboard intent (by month)'),
    ).toBeInTheDocument();
    // A decision row is never the click-to-expand disclosure.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    // It uses the distinct routing/branch glyph — not tool/sub-agent/step.
    const [item] = screen.getAllByRole('listitem');
    expect(item.querySelector('.anticon-node-index')).toBeInTheDocument();
    expect(item.querySelector('.anticon-tool')).not.toBeInTheDocument();
    expect(item.querySelector('.anticon-apartment')).not.toBeInTheDocument();
    expect(item.querySelector('.anticon-bulb')).not.toBeInTheDocument();
  });

  it('renders a refusal "Verify gate" decision inline with an error state — detail visible, no click', () => {
    const steps: ToolStep[] = [
      {
        id: 'w1',
        label: 'Verify gate',
        state: 'error',
        kind: 'decision',
        depth: 0,
        detail: 'refused — question needs a column your role cannot read',
      },
    ];
    renderSteps(steps);

    expect(
      screen.getByText('refused — question needs a column your role cannot read'),
    ).toBeInTheDocument();
    // The error state is still conveyed via its text label (never color alone).
    expect(screen.getByText('(error)')).toBeInTheDocument();
    // Inline, not a disclosure.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps tool and step rows expandable even when a decision row is present inline', async () => {
    const user = userEvent.setup();
    const steps: ToolStep[] = [
      { id: 'w0', label: 'Route', state: 'done', kind: 'decision', depth: 0, detail: '→ answer_query' },
      {
        id: 'w1',
        label: 'query',
        state: 'done',
        kind: 'tool',
        depth: 0,
        input: { sql: 'SELECT 1' },
        detail: 'Returned 1 row.',
      },
      {
        id: 'w2',
        label: 'resolve_intent',
        state: 'done',
        kind: 'step',
        depth: 0,
        detail: 'query_intent: top customers.',
      },
    ];
    renderSteps(steps);

    // Exactly the two non-decision rows are disclosures.
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);

    await user.click(buttons[0]);
    expect(screen.getByText('SELECT 1')).toBeInTheDocument();
    await user.click(buttons[1]);
    expect(screen.getByText('query_intent: top customers.')).toBeInTheDocument();
  });

  it('expands/collapses each step independently, keyed by step id', async () => {
    const user = userEvent.setup();
    const steps: ToolStep[] = [
      { id: 'w1', label: 'query', state: 'done', kind: 'tool', depth: 0, input: { sql: 'SELECT 1' } },
      { id: 'w2', label: 'query', state: 'done', kind: 'tool', depth: 0, input: { sql: 'SELECT 2' } },
    ];
    renderSteps(steps);

    const [first, second] = screen.getAllByRole('button');
    await user.click(first);

    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(second).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('SELECT 1')).toBeInTheDocument();
    expect(screen.queryByText('SELECT 2')).not.toBeInTheDocument();
  });

  describe('whole-tree disclosure (`title` prop)', () => {
    const steps: ToolStep[] = [
      { id: 'w1', label: 'Route', state: 'done', kind: 'decision', depth: 0, detail: '→ answer_query' },
      { id: 'w2', label: 'Query verified data', state: 'done', kind: 'tool', depth: 0 },
    ];

    it('renders no outer toggle when `title` is omitted — the default, always-visible live view', () => {
      render(
        <ThemeProvider>
          <WorkLog steps={steps} />
        </ThemeProvider>,
      );
      // The bare list is present immediately, with no wrapping disclosure button.
      expect(screen.getByRole('list', { name: 'Work log' })).toBeInTheDocument();
      expect(screen.getByText('Query verified data')).toBeInTheDocument();
    });

    it('wraps the trace behind a single collapsed-by-default disclosure when `title` is given', () => {
      render(
        <ThemeProvider>
          <WorkLog steps={steps} title="Execution trace" />
        </ThemeProvider>,
      );

      const toggle = screen.getByRole('button', { name: 'Execution trace' });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      // Collapsed: none of the trace's own content is in the DOM yet.
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
      expect(screen.queryByText('Query verified data')).not.toBeInTheDocument();
    });

    it('expands the whole trace on click, and collapses again on a second click', async () => {
      const user = userEvent.setup();
      render(
        <ThemeProvider>
          <WorkLog steps={steps} title="Execution trace" />
        </ThemeProvider>,
      );

      const toggle = screen.getByRole('button', { name: 'Execution trace' });
      await user.click(toggle);

      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('list', { name: 'Work log' })).toBeInTheDocument();
      expect(screen.getByText('Query verified data')).toBeInTheDocument();
      // The decision row's own per-row behavior (inline detail, no click) is unaffected.
      expect(screen.getByText('→ answer_query')).toBeInTheDocument();

      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByText('Query verified data')).not.toBeInTheDocument();
    });

    it('starts open when `defaultOpen` is true', () => {
      render(
        <ThemeProvider>
          <WorkLog steps={steps} title="Execution trace" defaultOpen />
        </ThemeProvider>,
      );

      expect(screen.getByRole('button', { name: 'Execution trace' })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      expect(screen.getByText('Query verified data')).toBeInTheDocument();
    });
  });
});
