import { Tag } from 'antd';
import { DataTable } from '@/ui';
import { t } from '@/i18n/strings';
import { StepDataflow } from './StepDataflow';
import type { Component, TierModelBinding } from './types';

interface ComponentsTableProps {
  components: Component[];
}

/**
 * Components table: the bundle's declared agents (never "sub-agents" — see
 * `types.ts`). Each row expands to the agent's tools, output blocks, and
 * step→artifact dataflow. Capability tags here are plain (id text only) —
 * the outcome-colored resolution view lives in `CapabilityResolutionTable`,
 * not repeated here.
 */
export function ComponentsTable({ components }: ComponentsTableProps) {
  return (
    <DataTable<Component>
      rowKey="id"
      dataSource={components}
      expandable={{
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
            <StepDataflow steps={component.steps} />
          </div>
        ),
      }}
      columns={[
        { title: t('harness.component'), dataIndex: 'name', key: 'name' },
        { title: t('harness.componentType'), dataIndex: 'componentType', key: 'componentType' },
        { title: t('harness.realization'), dataIndex: 'realizationLabel', key: 'realizationLabel' },
        {
          title: t('harness.tiers'),
          dataIndex: 'tiers',
          key: 'tiers',
          render: (tiers: TierModelBinding[]) => tiers.map((tm) => tm.tier).join(', '),
        },
        {
          title: t('harness.capabilitiesColumn'),
          dataIndex: 'capabilities',
          key: 'capabilities',
          render: (capabilities: Component['capabilities']) => (
            <>
              {capabilities.map((cap) => (
                <Tag key={cap.capability} bordered style={{ marginBottom: 4 }}>
                  {cap.capability}
                </Tag>
              ))}
            </>
          ),
        },
      ]}
    />
  );
}
