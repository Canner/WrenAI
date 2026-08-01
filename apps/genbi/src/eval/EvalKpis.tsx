import { Col, Row, Statistic } from 'antd';
import { Panel } from '@/ui';
import { t } from '@/i18n/strings';
import { GateStatusTag } from './GateStatusTag';
import type { EvalRun } from './types';

interface EvalKpisProps {
  run: EvalRun;
}

/**
 * KPI row for the selected eval run: verified-correct score, gate pass/fail
 * against its threshold, regressions, cost, and p50 latency. Gate status is
 * always icon + label (`GateStatusTag`), never color alone.
 */
export function EvalKpis({ run }: EvalKpisProps) {
  return (
    <Panel title={`${run.id} · ${run.when}`} extra={<GateStatusTag pass={run.gatePass} />}>
      <Row gutter={[16, 16]}>
        <Col xs={12} md={8} lg={4}>
          <Statistic title={t('eval.scoreLabel')} value={run.score} precision={2} />
        </Col>
        <Col xs={12} md={8} lg={4}>
          <Statistic title={t('eval.gateThresholdLabel')} value={run.gateThreshold} precision={2} />
        </Col>
        <Col xs={12} md={8} lg={4}>
          <Statistic title={t('eval.regressionsLabel')} value={run.regressions} />
        </Col>
        <Col xs={12} md={8} lg={4}>
          <Statistic title={t('eval.costLabel')} value={run.cost} />
        </Col>
        <Col xs={12} md={8} lg={4}>
          <Statistic title={t('eval.p50Label')} value={run.p50} />
        </Col>
      </Row>
    </Panel>
  );
}
