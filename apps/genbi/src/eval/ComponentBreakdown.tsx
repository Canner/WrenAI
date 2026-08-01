import { DataTable, Panel } from '@/ui';
import { t } from '@/i18n/strings';
import type { ComponentScore } from './types';

interface ComponentBreakdownProps {
  components: ComponentScore[];
}

function formatSigned(value: number): string {
  return value >= 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}

/** Score per component for the selected run, with its change vs. the previous run. */
export function ComponentBreakdown({ components }: ComponentBreakdownProps) {
  return (
    <Panel title={t('eval.byComponentTitle')}>
      <DataTable<ComponentScore>
        rowKey="component"
        dataSource={components}
        columns={[
          { title: t('eval.componentColumn'), dataIndex: 'component', key: 'component' },
          {
            title: t('eval.scoreColumn'),
            dataIndex: 'score',
            key: 'score',
            render: (score: number) => score.toFixed(2),
          },
          {
            title: t('eval.deltaColumn'),
            dataIndex: 'delta',
            key: 'delta',
            render: (delta: number) => formatSigned(delta),
          },
        ]}
      />
    </Panel>
  );
}
