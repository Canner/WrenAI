import { Tag } from 'antd';
import { DataTable, KVRow } from '@/ui';
import { t } from '@/i18n/strings';
import { StepDataflow } from './StepDataflow';
import type { Component } from './types';

interface ComponentsTableProps {
  components: Component[];
}

/**
 * Components table: the bundle's declared agents (never "sub-agents" — see
 * `types.ts`). Each row expands to the agent's tools, output blocks, and
 * step→artifact dataflow. Availability is intentionally a primary column;
 * lower-level capability resolution lives in Technical diagnostics.
 */
export function ComponentsTable({ components }: ComponentsTableProps) {
  return (
    <DataTable<Component>
      rowKey="id"
      dataSource={components}
      expandable={{
        rowExpandable: (component) => component.status !== 'unavailable',
        expandedRowRender: (component) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ opacity: 0.65, fontSize: 12 }}>{t('harness.toolsLabel')}:</span>
              {component.tools.length > 0 ? (
                component.tools.map((tool) => (
                  <Tag key={tool.name} bordered>
                    {tool.name}
                  </Tag>
                ))
              ) : (
                <span style={{ opacity: 0.65, fontSize: 12 }}>{t('harness.noneFallback')}</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ opacity: 0.65, fontSize: 12 }}>{t('harness.outputBlocksLabel')}:</span>
              {component.outputBlocks.length > 0 ? (
                component.outputBlocks.map((block) => (
                  <Tag key={block} bordered>
                    {block}
                  </Tag>
                ))
              ) : (
                <span style={{ opacity: 0.65, fontSize: 12 }}>{t('harness.noneFallback')}</span>
              )}
            </div>
            {component.outcome !== 'none' && (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ opacity: 0.65, fontSize: 12 }}>{t('harness.outcomeLabel')}:</span>
                <Tag bordered>{component.outcome}</Tag>
              </div>
            )}
            {component.nativeAvailability && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ opacity: 0.65, fontSize: 12 }}>{t('harness.programmaticallyUnavailable')}:</span>
                <KVRow label={t('harness.compiledDispatchTarget')} value={component.nativeAvailability.compiledDispatchTarget} />
                <KVRow label={t('harness.reason')} value={component.nativeAvailability.compiledUnavailableReason} />
              </div>
            )}
            <StepDataflow steps={component.steps} />
          </div>
        ),
      }}
      columns={[
        { title: t('harness.component'), dataIndex: 'name', key: 'name' },
        {
          title: t('harness.availability'),
          key: 'availability',
          render: (_: unknown, component: Component) => {
            if (component.status === 'unavailable') {
              return <Tag color="warning">{t('harness.unavailable')}: {component.unavailableReason ?? t('harness.reasonUnavailable')}</Tag>;
            }
            if (component.nativeAvailability) {
              return <Tag color="success">{t('harness.availableVia')} {component.nativeAvailability.viaLabel}</Tag>;
            }
            return <Tag color="success">{t('harness.available')}</Tag>;
          },
        },
        { title: t('harness.callableAs'), dataIndex: 'callableAs', key: 'callableAs' },
        { title: t('harness.componentType'), dataIndex: 'componentType', key: 'componentType' },
        { title: t('harness.realization'), dataIndex: 'realizationLabel', key: 'realizationLabel' },
      ]}
    />
  );
}
