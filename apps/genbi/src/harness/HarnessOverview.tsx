import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { Collapse, Space, Tag, Typography } from 'antd';
import { DataTable, KVRow, Panel } from '@/ui';
import { brand } from '@/app/theme/tokens';
import { t } from '@/i18n/strings';
import { AgentProfilesTable } from './AgentProfilesTable';
import { CapabilityResolutionTable } from './CapabilityResolutionTable';
import { ComponentsTable } from './ComponentsTable';
import { ConnectionHealthTag } from './ConnectionHealthTag';
import { GuardrailList } from './GuardrailList';
import type { HarnessView, RuntimeDispatcherKind, TierModelBinding } from './types';
import './harness.css';

interface HarnessOverviewProps {
  harness: HarnessView;
}

const DISPATCHER_LABELS: Record<RuntimeDispatcherKind, string> = {
  'claude-agent-sdk': t('harness.dispatcherClaudeAgentSdk'),
  'codex-local': t('harness.dispatcherCodexLocal'),
  'in-process': t('harness.dispatcherInProcess'),
};

/**
 * One purpose's status view. The primary path is purpose/profile → active
 * runtime target/readiness → executable components; implementation detail is
 * intentionally grouped in expandable diagnostics below that path.
 */
export function HarnessOverview({ harness }: HarnessOverviewProps) {
  const { purpose, profile, runtime, connection, components, agentProfiles, nativeSessions } = harness;
  const nativeSessionTarget = purpose.targetLabel ?? t('harness.targetNotConfigured');
  const readiness = purpose.available ? t('harness.ready') : t('harness.unavailable');

  return (
    <Space className="harness-overview" orientation="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Paragraph type="secondary" style={{ maxWidth: '64ch' }}>
        {t('harness.pageLeadPrefix')} <strong>{purpose.profile}</strong> {t('harness.pageLeadSuffix')}
      </Typography.Paragraph>

      <Panel
        title={t('harness.executionTitle')}
        note={t('harness.executionNote')}
        extra={
          <Tag
            color={purpose.available ? brand.verified : brand.estimate}
            icon={purpose.available ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
            bordered
          >
            {readiness}
          </Tag>
        }
      >
        <div className="harness-execution-path" aria-label={t('harness.executionTitle')}>
          <div>
            <Typography.Text type="secondary">{t('harness.purpose')}</Typography.Text>
            <strong>{purpose.purpose}</strong>
          </div>
          <div>
            <Typography.Text type="secondary">{t('harness.compiledDispatchTarget')}</Typography.Text>
            <strong>{profile.dispatchTarget}</strong>
          </div>
          <div>
            <Typography.Text type="secondary">{t('harness.nativeSessionTarget')}</Typography.Text>
            <strong>{nativeSessionTarget}</strong>
          </div>
          <div>
            <Typography.Text type="secondary">{t('harness.readiness')}</Typography.Text>
            <strong>{readiness}</strong>
          </div>
        </div>
        <KVRow label={t('harness.profile')} value={purpose.profile} />
        {!purpose.available && purpose.reason && <KVRow label={t('harness.reason')} value={purpose.reason} />}
      </Panel>

      <Panel title={t('harness.componentsTitle')} note={t('harness.componentsNote')}>
        <ComponentsTable components={components} />
      </Panel>

      <Panel title={t('harness.technicalDiagnosticsTitle')} note={t('harness.technicalDiagnosticsNote')}>
        <Collapse
          destroyOnHidden
          items={[
            {
              key: 'runtime',
              label: t('harness.runtimeDiagnosticsTitle'),
              children: <>
                <KVRow label={t('harness.authenticationBackend')} value={runtime.label} />
                {runtime.dispatcher !== undefined && (
                  <KVRow label={t('harness.dispatcherImplementation')} value={DISPATCHER_LABELS[runtime.dispatcher]} />
                )}
                <DataTable<TierModelBinding>
                  rowKey="tier"
                  dataSource={runtime.tierModels}
                  columns={[
                    { title: t('harness.tier'), dataIndex: 'tier', key: 'tier' },
                    { title: t('harness.model'), dataIndex: 'model', key: 'model' },
                  ]}
                />
              </>,
            },
            {
              key: 'profile',
              label: t('harness.profileDiagnosticsTitle'),
              children: <>
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
                <KVRow label={t('harness.bundle')} value={`${profile.bundleId} · v${profile.bundleVersion} · ${profile.bundleHash}`} />
              </>,
            },
            {
              key: 'connection',
              label: t('harness.connectionTitle'),
              children: <div className="harness-diagnostic-grid">
                <div>
                  <KVRow label={t('harness.connectionType')} value={connection.type} />
                  <KVRow label={t('harness.connectionLocation')} value={connection.location} />
                  <KVRow label={t('harness.connectionVia')} value={connection.via} />
                </div>
                <div>
                  <KVRow label={t('harness.health')} value={<ConnectionHealthTag health={connection.health} />} />
                  <KVRow label={t('harness.tablesSynced')} value={connection.tablesSynced} />
                  <KVRow label={t('harness.lastSync')} value={connection.lastSync} />
                </div>
              </div>,
            },
            { key: 'agent-profiles', label: t('harness.agentProfilesTitle'), children: <AgentProfilesTable profiles={agentProfiles} /> },
            { key: 'capabilities', label: t('harness.capabilityResolutionTitle'), children: <CapabilityResolutionTable components={components} /> },
            { key: 'guardrails', label: t('harness.guardrailsTitle'), children: <GuardrailList components={components} /> },
            {
              key: 'native-session-binding',
              label: t('harness.nativeBindingDiagnosticsTitle'),
              children: <>
                <KVRow label={t('harness.bindingGeneration')} value={nativeSessions.binding.generation} />
              </>,
            },
          ]}
        />
      </Panel>
    </Space>
  );
}
