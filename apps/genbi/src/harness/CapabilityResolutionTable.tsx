import { DataTable } from '@/ui';
import { t } from '@/i18n/strings';
import { CapabilityOutcomeTag } from './CapabilityOutcomeTag';
import type { Capability, Component } from './types';

interface CapabilityResolutionTableProps {
  components: Component[];
}

/**
 * Capability resolution, aggregated across all components and deduped by
 * capability id (first-seen component wins) — the dedup happens here, not in
 * the BFF client, since `HarnessView` keeps each component's own list.
 */
export function CapabilityResolutionTable({ components }: CapabilityResolutionTableProps) {
  const byId = new Map<string, Capability>();
  for (const component of components) {
    for (const cap of component.capabilities) {
      if (!byId.has(cap.capability)) byId.set(cap.capability, cap);
    }
  }
  const capabilities = Array.from(byId.values());

  return (
    <DataTable<Capability>
      rowKey="capability"
      dataSource={capabilities}
      columns={[
        { title: t('harness.capability'), dataIndex: 'capability', key: 'capability' },
        {
          title: t('harness.outcome'),
          dataIndex: 'outcome',
          key: 'outcome',
          render: (outcome: Capability['outcome']) => <CapabilityOutcomeTag outcome={outcome} />,
        },
        { title: t('harness.providedBy'), dataIndex: 'providedBy', key: 'providedBy' },
        {
          title: t('harness.criticality'),
          dataIndex: 'criticality',
          key: 'criticality',
          render: (criticality?: string) => criticality ?? '—',
        },
      ]}
    />
  );
}
