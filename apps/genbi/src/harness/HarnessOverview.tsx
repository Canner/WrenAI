import { Button, Space, Tag, Tooltip, Typography } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, ImportOutlined, PlusOutlined } from '@ant-design/icons';
import { Panel, KVRow, DataTable } from '@/ui';
import { brand } from '@/app/theme/tokens';
import { t } from '@/i18n/strings';
import { ConnectionHealthTag } from './ConnectionHealthTag';
import { AgentProfilesTable } from './AgentProfilesTable';
import { ComponentsTable } from './ComponentsTable';
import { CapabilityResolutionTable } from './CapabilityResolutionTable';
import { GuardrailList } from './GuardrailList';
import type { HarnessView, RuntimeDispatcherKind, TierModelBinding } from './types';

interface HarnessOverviewProps {
  harness: HarnessView;
}

/**
 * Friendly labels for the runtime dispatcher — deliberately just these two
 * identity strings, never the internal "Mode A" / "Mode B" vocabulary those
 * dispatchers are known by elsewhere in the codebase.
 */
const DISPATCHER_LABELS: Record<RuntimeDispatcherKind, string> = {
  'claude-agent-sdk': t('harness.dispatcherClaudeAgentSdk'),
  'in-process': t('harness.dispatcherInProcess'),
};

/**
 * Single scrollable status view over how the bound profile is realized:
 * profile → runtime/back-end → agent profiles → data source/connection →
 * components (expandable step dataflow) → capability resolution → guardrails.
 * Replaces the old orchestrator/sub-agent drill-down — there is exactly one
 * canvas for the one bound profile (see `HarnessSidebar` for the profile
 * selector this responds to).
 */
export function HarnessOverview({ harness }: HarnessOverviewProps) {
  const { profile, runtime, connection, components, agentProfiles } = harness;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Paragraph type="secondary" style={{ maxWidth: '64ch' }}>
        {t('harness.pageLeadPrefix')} <strong>{profile.name}</strong> {t('harness.pageLeadSuffix')}
      </Typography.Paragraph>

      <Panel
        title={profile.name}
        extra={
          <Tag color={brand.verified} icon={<CheckCircleOutlined />} bordered>
            {profile.status}
          </Tag>
        }
      >
        <KVRow label={t('harness.source')} value={`warble · IR v${profile.irVersion}`} />
        <KVRow label={t('harness.boundContext')} value={profile.boundContext} />
        <KVRow
          label={t('harness.verifyGate')}
          value={
            <Tag
              color={profile.verifyGate ? brand.verified : brand.refused}
              icon={profile.verifyGate ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
              bordered
            >
              {profile.verifyGate ? t('harness.verifyGateOn') : t('harness.verifyGateOff')}
            </Tag>
          }
        />
        <KVRow label={t('harness.dispatchTarget')} value={profile.dispatchTarget} />
        <KVRow
          label={t('harness.bundle')}
          value={`${profile.bundleId} · v${profile.bundleVersion} · ${profile.bundleHash}`}
        />
      </Panel>

      <Panel title={t('harness.runtimeTitle')} note={t('harness.runtimeBackendNote')}>
        <KVRow label={t('harness.activeBackend')} value={runtime.label} />
        {runtime.dispatcher !== undefined && (
          <KVRow label={t('harness.dispatcher')} value={DISPATCHER_LABELS[runtime.dispatcher]} />
        )}
        {runtime.backend !== 'subscription' && (
          <KVRow
            label={
              <Tooltip title={t('harness.alsoAvailableHint')}>
                <span>{t('harness.alsoAvailable')}</span>
              </Tooltip>
            }
            value={<Typography.Text type="secondary">{t('harness.subscriptionAvailable')}</Typography.Text>}
          />
        )}
        <DataTable<TierModelBinding>
          rowKey="tier"
          dataSource={runtime.tierModels}
          columns={[
            { title: t('harness.tier'), dataIndex: 'tier', key: 'tier' },
            { title: t('harness.model'), dataIndex: 'model', key: 'model' },
          ]}
        />
      </Panel>

      <Panel title={t('harness.agentProfilesTitle')} note={t('harness.agentProfilesNote')}>
        <AgentProfilesTable profiles={agentProfiles} />
        <Space wrap style={{ marginTop: 8 }}>
          <Tooltip title={t('harness.outOfScopeHint')}>
            <Button icon={<PlusOutlined />} disabled>
              {t('harness.addProfile')}
            </Button>
          </Tooltip>
          <Tooltip title={t('harness.outOfScopeHint')}>
            <Button icon={<ImportOutlined />} disabled>
              {t('harness.importProfile')}
            </Button>
          </Tooltip>
        </Space>
      </Panel>

      <Panel title={t('harness.connectionTitle')}>
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <KVRow label={t('harness.connectionType')} value={connection.type} />
            <KVRow label={t('harness.connectionLocation')} value={connection.location} />
            <KVRow label={t('harness.connectionVia')} value={connection.via} />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <KVRow label={t('harness.health')} value={<ConnectionHealthTag health={connection.health} />} />
            <KVRow label={t('harness.tablesSynced')} value={connection.tablesSynced} />
            <KVRow label={t('harness.lastSync')} value={connection.lastSync} />
          </div>
        </div>
        <Space wrap style={{ marginTop: 8 }}>
          <Tooltip title={t('harness.outOfScopeHint')}>
            <Button disabled>{t('harness.testConnection')}</Button>
          </Tooltip>
          <Tooltip title={t('harness.outOfScopeHint')}>
            <Button disabled>{t('harness.resyncTables')}</Button>
          </Tooltip>
          <Tooltip title={t('harness.outOfScopeHint')}>
            <Button disabled>{t('harness.manageSource')}</Button>
          </Tooltip>
        </Space>
      </Panel>

      <Panel title={t('harness.componentsTitle')}>
        <ComponentsTable components={components} />
      </Panel>

      <Panel title={t('harness.capabilityResolutionTitle')}>
        <CapabilityResolutionTable components={components} />
      </Panel>

      <Panel title={t('harness.guardrailsTitle')}>
        <GuardrailList components={components} />
      </Panel>
    </Space>
  );
}
