import { Alert, Card, Col, Row, Tag, Typography } from 'antd';
import { ApiType } from '@/apollo/client/graphql/__types__';

export interface AskShadowCompareBucket {
  key: string;
  count: number;
}

export interface AskShadowCompareTrendBucket {
  date: string;
  total: number;
  executed: number;
  comparable: number;
  matched: number;
  mismatched: number;
  errorCount: number;
}

export interface AskShadowCompareStatsView {
  total: number;
  withDiagnostics: number;
  enabled: number;
  executed: number;
  comparable: number;
  matched: number;
  mismatched: number;
  errorCount: number;
  byAskPath: AskShadowCompareBucket[];
  byShadowErrorType: AskShadowCompareBucket[];
  trends: AskShadowCompareTrendBucket[];
}

export type AskShadowCompareRolloutStatus =
  | 'no_data'
  | 'investigate_shadow_errors'
  | 'waiting_for_comparable_samples'
  | 'blocked_on_comparable_mismatches'
  | 'ready_for_canary';

export interface AskShadowCompareRolloutReadinessView {
  status: AskShadowCompareRolloutStatus;
  recommendedMode: 'keep_legacy' | 'canary_deepagents';
  reason: string;
  comparableMatchRate: number;
  comparableMismatchRate: number;
  errorRate: number;
}

type Props = {
  stats?: AskShadowCompareStatsView | null;
  loading?: boolean;
  unsupportedApiType?: ApiType | null;
};

const EMPTY_STATS: AskShadowCompareStatsView = {
  total: 0,
  withDiagnostics: 0,
  enabled: 0,
  executed: 0,
  comparable: 0,
  matched: 0,
  mismatched: 0,
  errorCount: 0,
  byAskPath: [],
  byShadowErrorType: [],
  trends: [],
};

export const deriveShadowCompareRolloutReadiness = (
  stats?: AskShadowCompareStatsView | null,
): AskShadowCompareRolloutReadinessView => {
  const normalized = stats || EMPTY_STATS;
  const comparableDenominator = normalized.comparable || 1;
  const executedDenominator = normalized.executed || 1;

  if (normalized.total === 0) {
    return {
      status: 'no_data',
      recommendedMode: 'keep_legacy',
      reason: 'No shadow compare samples recorded yet.',
      comparableMatchRate: 0,
      comparableMismatchRate: 0,
      errorRate: 0,
    };
  }

  if (normalized.errorCount > 0) {
    return {
      status: 'investigate_shadow_errors',
      recommendedMode: 'keep_legacy',
      reason: 'Shadow compare recorded legacy shadow errors.',
      comparableMatchRate: normalized.matched / comparableDenominator,
      comparableMismatchRate:
        normalized.mismatched / comparableDenominator,
      errorRate: normalized.errorCount / executedDenominator,
    };
  }

  if (normalized.comparable === 0) {
    return {
      status: 'waiting_for_comparable_samples',
      recommendedMode: 'keep_legacy',
      reason:
        'Current shadow compares do not yet produce directly comparable primary and shadow results.',
      comparableMatchRate: 0,
      comparableMismatchRate: 0,
      errorRate: 0,
    };
  }

  if (normalized.mismatched > 0) {
    return {
      status: 'blocked_on_comparable_mismatches',
      recommendedMode: 'keep_legacy',
      reason: 'Comparable shadow compare samples still contain mismatches.',
      comparableMatchRate: normalized.matched / comparableDenominator,
      comparableMismatchRate:
        normalized.mismatched / comparableDenominator,
      errorRate: 0,
    };
  }

  return {
    status: 'ready_for_canary',
    recommendedMode: 'canary_deepagents',
    reason: 'Comparable shadow compare samples are matching.',
    comparableMatchRate: normalized.matched / comparableDenominator,
    comparableMismatchRate: normalized.mismatched / comparableDenominator,
    errorRate: 0,
  };
};

const formatRate = (numerator: number, denominator: number) => {
  if (denominator <= 0) {
    return '-';
  }

  return `${Math.round((numerator / denominator) * 100)}% (${numerator}/${denominator})`;
};

const renderBuckets = (
  buckets: AskShadowCompareBucket[],
  emptyLabel: string,
) => {
  if (!buckets.length) {
    return <span className="gray-7">{emptyLabel}</span>;
  }

  return buckets.slice(0, 5).map((bucket) => (
    <Tag key={bucket.key} className="mr-2 mb-2 gray-8">
      {bucket.key}: {bucket.count}
    </Tag>
  ));
};

const renderTrends = (
  trends: AskShadowCompareTrendBucket[],
  emptyLabel: string,
) => {
  if (!trends.length) {
    return <span className="gray-7">{emptyLabel}</span>;
  }

  return trends.slice(-7).map((trend) => (
    <div key={trend.date} className="mb-2">
      <Typography.Text className="gray-7">{trend.date}</Typography.Text>
      <div>
        total {trend.total} · executed {trend.executed} · matched{' '}
        {trend.matched} · mismatched {trend.mismatched} · errors{' '}
        {trend.errorCount}
      </div>
    </div>
  ));
};

export default function ShadowCompareSummary(props: Props) {
  const { loading, unsupportedApiType } = props;
  const stats = props.stats || EMPTY_STATS;
  const readiness = deriveShadowCompareRolloutReadiness(stats);

  if (unsupportedApiType) {
    return (
      <Alert
        type="info"
        showIcon
        message="Shadow compare rollout"
        description={`Rollout stats only support ASK / STREAM_ASK records. Current API type filter: ${unsupportedApiType.toLowerCase()}.`}
      />
    );
  }

  return (
    <Card
      size="small"
      loading={loading}
      title="Shadow compare rollout"
      className="mb-4"
    >
      <Alert
        type={
          readiness.status === 'ready_for_canary'
            ? 'success'
            : readiness.status === 'no_data' ||
                readiness.status === 'waiting_for_comparable_samples'
              ? 'info'
              : 'warning'
        }
        showIcon
        message={`Recommendation: ${readiness.recommendedMode}`}
        description={`${readiness.reason} Match ${Math.round(
          readiness.comparableMatchRate * 100,
        )}% · mismatch ${Math.round(
          readiness.comparableMismatchRate * 100,
        )}% · errors ${Math.round(readiness.errorRate * 100)}%.`}
        className="mb-4"
      />

      <Row gutter={[16, 16]}>
        <Col span={6}>
          <Typography.Text className="gray-7 d-block mb-1">
            Records
          </Typography.Text>
          <div className="text-medium">{stats.total}</div>
        </Col>
        <Col span={6}>
          <Typography.Text className="gray-7 d-block mb-1">
            Diagnostics coverage
          </Typography.Text>
          <div className="text-medium">
            {formatRate(stats.withDiagnostics, stats.total)}
          </div>
        </Col>
        <Col span={6}>
          <Typography.Text className="gray-7 d-block mb-1">
            Shadow executed
          </Typography.Text>
          <div className="text-medium">
            {formatRate(stats.executed, stats.enabled)}
          </div>
        </Col>
        <Col span={6}>
          <Typography.Text className="gray-7 d-block mb-1">
            Match rate
          </Typography.Text>
          <div className="text-medium">
            {formatRate(stats.matched, stats.comparable)}
          </div>
        </Col>
      </Row>

      <Row gutter={[16, 16]} className="mt-4">
        <Col span={8}>
          <Typography.Text className="gray-7 d-block mb-1">
            Comparable
          </Typography.Text>
          <div>{stats.comparable}</div>
        </Col>
        <Col span={8}>
          <Typography.Text className="gray-7 d-block mb-1">
            Mismatched
          </Typography.Text>
          <div>{stats.mismatched}</div>
        </Col>
        <Col span={8}>
          <Typography.Text className="gray-7 d-block mb-1">
            Shadow errors
          </Typography.Text>
          <div>{stats.errorCount}</div>
        </Col>
      </Row>

      <div className="mt-4">
        <Typography.Text className="gray-7 d-block mb-2">
          Top ask paths
        </Typography.Text>
        <div>{renderBuckets(stats.byAskPath, 'No ask diagnostics yet')}</div>
      </div>

      <div className="mt-4">
        <Typography.Text className="gray-7 d-block mb-2">
          Shadow error types
        </Typography.Text>
        <div>{renderBuckets(stats.byShadowErrorType, 'No shadow errors')}</div>
      </div>

      <div className="mt-4">
        <Typography.Text className="gray-7 d-block mb-2">
          Recent trend
        </Typography.Text>
        <div>{renderTrends(stats.trends, 'No trend data yet')}</div>
      </div>
    </Card>
  );
}
