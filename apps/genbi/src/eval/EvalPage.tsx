import { useEffect } from 'react';
import { Segmented, Space } from 'antd';
import { PageContainer, PageState } from '@/ui';
import { t } from '@/i18n/strings';
import { isBffEnabled } from '@/bff/env';
import { useEvalStore } from './useEvalStore';
import { EvalKpis } from './EvalKpis';
import { ScoreTrend } from './ScoreTrend';
import { ComponentBreakdown } from './ComponentBreakdown';
import { QuestionsPlaceholder } from './QuestionsPlaceholder';

/**
 * Eval page canvas: GLOBAL eval scores only for the selected run
 * (`useEvalStore`) — see `EvalSidebar` for how a run is selected. Renders
 * KPIs (score, gate pass/fail, regressions, cost, p50), a score trend across
 * the last N runs, and a by-component breakdown for the selected run. The
 * "Questions" tab (by-question drill-down) is a disabled placeholder — out
 * of scope for this phase.
 */
export function EvalPage() {
  const selectedRunId = useEvalStore((s) => s.selectedRunId);
  const runs = useEvalStore((s) => s.runs);
  const componentScoresByRunId = useEvalStore((s) => s.componentScoresByRunId);
  const loadRuns = useEvalStore((s) => s.loadRuns);
  const loadingRuns = useEvalStore((s) => s.loadingRuns);
  const error = useEvalStore((s) => s.error);
  const run = runs.find((r) => r.id === selectedRunId);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  const live = isBffEnabled();

  let body;
  if (live && loadingRuns) {
    body = <PageState status="loading" />;
  } else if (live && error) {
    body = <PageState status="error" title={t('eval.loadErrorTitle')} description={error} onRetry={loadRuns} />;
  } else if (!run) {
    body = <PageState status="empty" title={t('eval.emptyTitle')} description={t('eval.emptyDescription')} />;
  } else {
    body = (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Segmented
          value="global"
          options={[
            { label: t('eval.globalTab'), value: 'global' },
            { label: t('eval.questionsTab'), value: 'questions', disabled: true },
          ]}
        />
        <EvalKpis run={run} />
        <ScoreTrend runs={runs} />
        <ComponentBreakdown components={componentScoresByRunId[run.id] ?? []} />
        <QuestionsPlaceholder />
      </Space>
    );
  }

  return (
    <PageContainer maxWidth={1000} title={t('nav.eval')} lead={t('eval.pageLead')}>
      {body}
    </PageContainer>
  );
}
