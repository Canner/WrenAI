import { Alert, Card, Col, Row, Tag, Typography } from 'antd';
import { ApiType } from '@/apollo/client/graphql/__types__';
import { formatApiTypeLabel } from './apiTypeLabels';

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

const ROLLOUT_MODE_LABELS: Record<
  AskShadowCompareRolloutReadinessView['recommendedMode'],
  string
> = {
  keep_legacy: '保留旧链路',
  canary_deepagents: '逐步切到 deepagents',
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
      reason: '还没有记录到影子对比样本。',
      comparableMatchRate: 0,
      comparableMismatchRate: 0,
      errorRate: 0,
    };
  }

  if (normalized.errorCount > 0) {
    return {
      status: 'investigate_shadow_errors',
      recommendedMode: 'keep_legacy',
      reason: '影子对比已经记录到旧链路的影子执行错误。',
      comparableMatchRate: normalized.matched / comparableDenominator,
      comparableMismatchRate: normalized.mismatched / comparableDenominator,
      errorRate: normalized.errorCount / executedDenominator,
    };
  }

  if (normalized.comparable === 0) {
    return {
      status: 'waiting_for_comparable_samples',
      recommendedMode: 'keep_legacy',
      reason: '当前影子对比还没有产出可以直接比较的主链路与影子链路结果。',
      comparableMatchRate: 0,
      comparableMismatchRate: 0,
      errorRate: 0,
    };
  }

  if (normalized.mismatched > 0) {
    return {
      status: 'blocked_on_comparable_mismatches',
      recommendedMode: 'keep_legacy',
      reason: '可比对的影子样本里仍然存在结果不匹配。',
      comparableMatchRate: normalized.matched / comparableDenominator,
      comparableMismatchRate: normalized.mismatched / comparableDenominator,
      errorRate: 0,
    };
  }

  return {
    status: 'ready_for_canary',
    recommendedMode: 'canary_deepagents',
    reason: '可比对的影子样本已经全部匹配，可以进入金丝雀验证。',
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
        总数 {trend.total} · 已执行 {trend.executed} · 已匹配 {trend.matched} ·
        不匹配 {trend.mismatched} · 错误 {trend.errorCount}
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
        message="影子对比发布看板"
        description={`当前发布统计只支持 ASK / STREAM_ASK 请求记录。当前 API 类型筛选：${formatApiTypeLabel(unsupportedApiType)}。`}
      />
    );
  }

  return (
    <Card
      size="small"
      loading={loading}
      title="影子对比发布看板"
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
        message={`建议策略：${ROLLOUT_MODE_LABELS[readiness.recommendedMode]}`}
        description={`${readiness.reason} 匹配率 ${Math.round(
          readiness.comparableMatchRate * 100,
        )}% · 不匹配率 ${Math.round(
          readiness.comparableMismatchRate * 100,
        )}% · 错误率 ${Math.round(readiness.errorRate * 100)}%。`}
        className="mb-4"
      />

      <Row gutter={[16, 16]}>
        <Col span={6}>
          <Typography.Text className="gray-7 d-block mb-1">
            请求记录数
          </Typography.Text>
          <div className="text-medium">{stats.total}</div>
        </Col>
        <Col span={6}>
          <Typography.Text className="gray-7 d-block mb-1">
            诊断覆盖率
          </Typography.Text>
          <div className="text-medium">
            {formatRate(stats.withDiagnostics, stats.total)}
          </div>
        </Col>
        <Col span={6}>
          <Typography.Text className="gray-7 d-block mb-1">
            已执行影子链路
          </Typography.Text>
          <div className="text-medium">
            {formatRate(stats.executed, stats.enabled)}
          </div>
        </Col>
        <Col span={6}>
          <Typography.Text className="gray-7 d-block mb-1">
            匹配率
          </Typography.Text>
          <div className="text-medium">
            {formatRate(stats.matched, stats.comparable)}
          </div>
        </Col>
      </Row>

      <Row gutter={[16, 16]} className="mt-4">
        <Col span={8}>
          <Typography.Text className="gray-7 d-block mb-1">
            可比对样本
          </Typography.Text>
          <div>{stats.comparable}</div>
        </Col>
        <Col span={8}>
          <Typography.Text className="gray-7 d-block mb-1">
            不匹配样本
          </Typography.Text>
          <div>{stats.mismatched}</div>
        </Col>
        <Col span={8}>
          <Typography.Text className="gray-7 d-block mb-1">
            影子链路错误
          </Typography.Text>
          <div>{stats.errorCount}</div>
        </Col>
      </Row>

      <div className="mt-4">
        <Typography.Text className="gray-7 d-block mb-2">
          主要问答路径
        </Typography.Text>
        <div>{renderBuckets(stats.byAskPath, '暂时还没有问答诊断数据')}</div>
      </div>

      <div className="mt-4">
        <Typography.Text className="gray-7 d-block mb-2">
          影子错误类型
        </Typography.Text>
        <div>{renderBuckets(stats.byShadowErrorType, '暂无影子链路错误')}</div>
      </div>

      <div className="mt-4">
        <Typography.Text className="gray-7 d-block mb-2">
          最近趋势
        </Typography.Text>
        <div>{renderTrends(stats.trends, '暂时还没有趋势数据')}</div>
      </div>
    </Card>
  );
}
