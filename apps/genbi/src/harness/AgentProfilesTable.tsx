import { Tag } from 'antd';
import { DataTable } from '@/ui';
import { t } from '@/i18n/strings';
import type { AgentProfileRow } from './types';

interface AgentProfilesTableProps {
  profiles: AgentProfileRow[];
}

/**
 * Agent profiles table: the bound orchestrator profile (live = one row)
 * plus any Phase-3 spawnable sub-agent profiles, greyed until that
 * capability lands — profile-level `orchestrator`/`sub-agent` vocabulary
 * lives here, not on `Component`.
 */
export function AgentProfilesTable({ profiles }: AgentProfilesTableProps) {
  return (
    <DataTable<AgentProfileRow>
      rowKey="name"
      dataSource={profiles}
      onRow={(record) => (record.role === 'sub-agent' ? { style: { opacity: 0.55 } } : {})}
      columns={[
        { title: t('harness.profileColumn'), dataIndex: 'name', key: 'name' },
        {
          title: t('harness.role'),
          dataIndex: 'role',
          key: 'role',
          render: (role: AgentProfileRow['role']) =>
            role === 'orchestrator' ? t('harness.roleOrchestrator') : t('harness.roleSubAgent'),
        },
        { title: t('harness.tierModel'), dataIndex: 'tierModel', key: 'tierModel' },
        {
          title: t('harness.capabilitiesColumn'),
          dataIndex: 'capabilities',
          key: 'capabilities',
          render: (capabilities: AgentProfileRow['capabilities']) => (
            <>
              {capabilities.map((cap) => (
                <Tag key={cap.capability} bordered style={{ marginBottom: 4 }}>
                  {cap.capability}
                </Tag>
              ))}
            </>
          ),
        },
        {
          title: t('harness.callableAs'),
          dataIndex: 'callableAs',
          key: 'callableAs',
          render: (callableAs?: string) => callableAs ?? '—',
        },
        { title: t('harness.status'), dataIndex: 'status', key: 'status' },
      ]}
    />
  );
}
