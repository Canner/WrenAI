import { Button, Space, Tooltip } from 'antd';
import { UnorderedListOutlined, FileSearchOutlined, LineChartOutlined } from '@ant-design/icons';
import { Panel } from '@/ui';
import { t } from '@/i18n/strings';

/**
 * By-question drill-down is out of scope for this phase — a "Not available
 * yet" panel greys out the question list, single-question detail, and
 * per-question score history. Same disabled-placeholder convention as
 * `HarnessOverview` / `Overview` / `ImpactView`.
 */
export function QuestionsPlaceholder() {
  return (
    <Panel title={t('eval.outOfScopeTitle')}>
      <Space wrap>
        <Tooltip title={t('eval.outOfScopeHint')}>
          <Button icon={<UnorderedListOutlined />} disabled>
            {t('eval.outOfScopeQuestionList')}
          </Button>
        </Tooltip>
        <Tooltip title={t('eval.outOfScopeHint')}>
          <Button icon={<FileSearchOutlined />} disabled>
            {t('eval.outOfScopeQuestionDetail')}
          </Button>
        </Tooltip>
        <Tooltip title={t('eval.outOfScopeHint')}>
          <Button icon={<LineChartOutlined />} disabled>
            {t('eval.outOfScopeScoreHistory')}
          </Button>
        </Tooltip>
      </Space>
    </Panel>
  );
}
