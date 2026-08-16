import { useState, type ReactNode } from 'react';
import {
  ApartmentOutlined,
  BulbOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DownOutlined,
  LoadingOutlined,
  NodeIndexOutlined,
  RightOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { brand } from '@/app/theme/tokens';
import { t } from '@/i18n/strings';
import type { ToolStep } from './types';

interface WorkLogProps {
  steps: ToolStep[];
  /**
   * Wraps the whole trace behind a single top-level disclosure labeled with
   * this title — the "whole-tree" collapse, distinct from each row's own
   * expand/collapse. Used to embed a completed turn's persisted trace in
   * history, collapsed by default (see `defaultOpen`). Omit to render the
   * trace with no outer toggle — the always-visible, in-progress live view.
   */
  title?: string;
  /** Whether the whole-tree disclosure starts open. Only meaningful with `title`; defaults to closed, since the whole point is a finished turn's trace starting collapsed. */
  defaultOpen?: boolean;
}

const STATE_ICON: Record<ToolStep['state'], ReactNode> = {
  running: <LoadingOutlined spin />,
  done: <CheckCircleOutlined />,
  error: <CloseCircleOutlined />,
};

const STATE_COLOR: Record<ToolStep['state'], string> = {
  running: 'var(--ant-color-text-secondary)',
  done: 'var(--ant-color-success)',
  error: 'var(--ant-color-error)',
};

const STATE_LABEL: Record<ToolStep['state'], string> = {
  running: t('ask.stepRunning'),
  done: t('ask.stepDone'),
  error: t('ask.stepError'),
};

/**
 * Per-kind glyph: a wrench for tool calls, an org chart for sub-agent
 * delegation, a bulb for an LLM reasoning step (`kind: 'step'`), and a
 * node-index (routing/branch) glyph for a control-flow decision
 * (`kind: 'decision'`) — each visually distinct so the reasoning flow, the
 * tool trace, and the turn's control-flow decisions read apart from one another.
 */
const KIND_ICON: Record<ToolStep['kind'], ReactNode> = {
  tool: <ToolOutlined />,
  subagent: <ApartmentOutlined />,
  step: <BulbOutlined />,
  decision: <NodeIndexOutlined />,
};

/**
 * Label for a step's `detail` panel, driven by data: an errored step reads
 * "Error", an LLM reasoning step (`kind: 'step'`) reads "Reasoning", and a
 * done tool step reads "Result".
 */
function detailLabel(step: ToolStep): string {
  if (step.state === 'error') return t('ask.stepErrorDetailLabel');
  if (step.kind === 'step') return t('ask.stepReasoningLabel');
  return t('ask.stepResultLabel');
}

/**
 * A step is expandable only when it carries an execution record — a
 * tool-call row like `query` has `input` and/or `detail`; LLM/step rows
 * (e.g. `resolve_intent`, `generate_sql`) have neither and stay plain,
 * non-clickable rows exactly as before.
 *
 * A `kind: 'decision'` row is never a click-to-expand disclosure: its `detail`
 * is shown INLINE (see below), so decisions are always visible at a glance
 * rather than hidden behind a toggle.
 */
function isExpandable(step: ToolStep): boolean {
  if (step.kind === 'decision') return false;
  return step.input !== undefined || step.detail !== undefined || step.inspection !== undefined;
}

/**
 * Renders a step's `input` as a monospace block: the bare SQL string when
 * the input is the common `{ sql }` shape, else pretty-printed JSON.
 */
function formatInput(input: unknown): string {
  if (
    typeof input === 'object' &&
    input !== null &&
    'sql' in input &&
    typeof (input as { sql?: unknown }).sql === 'string'
  ) {
    return (input as { sql: string }).sql;
  }
  return JSON.stringify(input, null, 2);
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${durationMs} ms`;
  return `${(durationMs / 1_000).toFixed(durationMs % 1_000 === 0 ? 0 : 1)} s`;
}

/**
 * Renders a turn's tool trace: plain tool calls plus delegated sub-agent
 * steps (indented by `depth`). State is always icon + text label, never
 * color alone; the mono `fontFamilyCode` gives it a terminal/log feel.
 *
 * Pass `title` to wrap the whole trace behind one top-level disclosure (the
 * "whole-tree" collapse) — used to embed a completed turn's persisted trace
 * in history, collapsed by default; omit it for the always-visible live view
 * of the currently-streaming turn.
 *
 * Steps that carry an `input` and/or `detail` (e.g. a `query` step's SQL
 * plus its result summary or error message — especially useful for
 * inspecting SQL-repair retries, a done query alongside N errored ones) are
 * clickable disclosures. Each expands/collapses independently, tracked by
 * step id in local component state.
 */
export function WorkLog({ steps, title, defaultOpen = false }: WorkLogProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState(defaultOpen);
  if (steps.length === 0) return null;

  const toggle = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const list = (
    <ul
      aria-label={t('ask.workLog')}
      style={{
        listStyle: 'none',
        margin: 0,
        padding: '8px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        fontFamily: brand.fontFamilyCode,
        fontSize: 12,
        background: 'var(--ant-color-fill-tertiary)',
        borderRadius: 8,
      }}
    >
      {steps.map((step) => {
        const expandable = isExpandable(step);
        const open = expandable && !!expanded[step.id];

        // A decision row shows its detail INLINE (never behind a click): the
        // turn's control-flow choice + reasoning is visible at a glance.
        const inlineDetail =
          step.kind === 'decision'
            ? step.detail ?? step.inspection?.error ?? step.inspection?.output
            : undefined;

        const rowContent = (
          <>
            <span aria-hidden="true">{STATE_ICON[step.state]}</span>
            <span aria-hidden="true">{KIND_ICON[step.kind]}</span>
            <span style={{ color: 'var(--ant-color-text)' }}>{step.label}</span>
            {inlineDetail !== undefined && (
              <span
                style={{
                  color: 'var(--ant-color-text-secondary)',
                  minWidth: 0,
                  whiteSpace: 'normal',
                  wordBreak: 'break-word',
                }}
              >
                {inlineDetail}
              </span>
            )}
            <span style={{ fontSize: 10, opacity: 0.65 }}>({STATE_LABEL[step.state]})</span>
            {expandable && (
              <span aria-hidden="true" style={{ marginInlineStart: 'auto', opacity: 0.65 }}>
                {open ? <DownOutlined /> : <RightOutlined />}
              </span>
            )}
          </>
        );

        return (
          <li
            key={step.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              paddingLeft: (step.depth ?? 0) * 16,
            }}
          >
            {expandable ? (
              <button
                type="button"
                aria-expanded={open}
                aria-label={`${step.label} (${STATE_LABEL[step.state]}) — ${t('ask.stepToggleLabel')}`}
                onClick={() => toggle(step.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  margin: 0,
                  font: 'inherit',
                  textAlign: 'left',
                  cursor: 'pointer',
                  color: STATE_COLOR[step.state],
                }}
              >
                {rowContent}
              </button>
            ) : (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  color: STATE_COLOR[step.state],
                }}
              >
                {rowContent}
              </div>
            )}

            {expandable && open && (
              <div
                style={{
                  marginInlineStart: 20,
                  padding: '6px 8px',
                  borderRadius: 6,
                  background: 'var(--ant-color-fill-quaternary)',
                  color: 'var(--ant-color-text)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                {step.input !== undefined && (
                  <div>
                    <div style={{ fontSize: 10, opacity: 0.65 }}>{t('ask.stepInputLabel')}</div>
                    <pre
                      style={{
                        margin: '2px 0 0',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      <code>{formatInput(step.input)}</code>
                    </pre>
                  </div>
                )}
                {step.detail !== undefined && (
                  <div>
                    <div style={{ fontSize: 10, opacity: 0.65 }}>{detailLabel(step)}</div>
                    <div style={{ marginTop: 2, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {step.detail}
                    </div>
                  </div>
                )}
                {step.inspection !== undefined && (
                  <>
                    {step.inspection.action !== undefined && (
                      <div>
                        <div style={{ fontSize: 10, opacity: 0.65 }}>{t('ask.stepActionLabel')}</div>
                        <pre
                          style={{
                            margin: '2px 0 0',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                          }}
                        >
                          <code>{step.inspection.action}</code>
                        </pre>
                      </div>
                    )}
                    {step.inspection.output !== undefined && (
                      <div>
                        <div style={{ fontSize: 10, opacity: 0.65 }}>{t('ask.stepOutputLabel')}</div>
                        <div style={{ marginTop: 2, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {step.inspection.output}
                        </div>
                      </div>
                    )}
                    {step.inspection.error !== undefined && (
                      <div>
                        <div style={{ fontSize: 10, opacity: 0.65 }}>{t('ask.stepErrorDetailLabel')}</div>
                        <div style={{ marginTop: 2, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {step.inspection.error}
                        </div>
                      </div>
                    )}
                    {step.inspection.durationMs !== undefined && (
                      <div>
                        <span style={{ fontSize: 10, opacity: 0.65 }}>{t('ask.stepDurationLabel')}: </span>
                        <span>{formatDuration(step.inspection.durationMs)}</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );

  if (title === undefined) return list;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: 'fit-content',
          background: 'transparent',
          border: 'none',
          padding: 0,
          margin: 0,
          font: 'inherit',
          fontSize: 12,
          cursor: 'pointer',
          color: 'var(--ant-color-text-secondary)',
        }}
      >
        <span aria-hidden="true">{open ? <DownOutlined /> : <RightOutlined />}</span>
        <span>{title}</span>
      </button>
      {open && list}
    </div>
  );
}
