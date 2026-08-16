import { Alert, Button, Space } from 'antd';
import { Panel, KVRow } from '@/ui';
import { t } from '@/i18n/strings';
import { WorkLog } from '@/session/WorkLog';
import { useSetupStore } from './useSetupStore';
import { DecisionCard } from './DecisionCard';
import { SetupFailurePanel } from './SetupFailurePanel';

/**
 * Step 3 (Build data model): discover the schema and establish models and
 * relationships from the connected source. In live (BFF) mode this starts a real agentic turn and
 * streams its WorkLog inline; the step only advances once the stream's
 * terminal reports success — never on the click itself. The project,
 * workspace, and connect form are already on record from step 2, so this
 * step takes no inputs of its own (no project name, no credentials) — it
 * just re-runs against the already-connected project. In fixture mode (no
 * BFF configured) "Build data model" still just marks the step done
 * synchronously, as before.
 */
export function ContextStepCard() {
  const buildContext = useSetupStore((s) => s.buildContext);
  const resolveContextDecision = useSetupStore((s) => s.resolveContextDecision);
  const retryContextFailure = useSetupStore((s) => s.retryContextFailure);
  const contextStream = useSetupStore((s) => s.contextStream);
  const contextSummary = useSetupStore((s) => s.contextSummary);
  const { streaming, workLog, error, failure, needsInput, decision, terminal } = contextStream;

  const note =
    terminal?.status === 'ok'
      ? t('setup.contextBuiltNote')
      : streaming
        ? t('setup.contextBuildingNote')
        : t('setup.contextDescription');

  return (
    <Panel title={t('setup.contextTitle')} note={note}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div>
          <KVRow label={t('setup.contextModels')} value={contextSummary.models} />
          <KVRow label={t('setup.contextRelationships')} value={contextSummary.relationships} />
        </div>
        <Button type="primary" disabled={streaming || Boolean(decision)} loading={streaming} onClick={buildContext}>
          {t('setup.contextAction')}
        </Button>

        {/* The current turn's live trace only — once it completes, its trace
            is already carried on the persisted transcript message and
            rendered there instead (see `ConversationView`), so this raw view
            is hidden to avoid showing it twice (mirrors `AskSession`). */}
        {streaming && workLog.length > 0 && <WorkLog steps={workLog} />}

        {decision && (
          <DecisionCard decision={decision} resolving={streaming} onChoose={resolveContextDecision} />
        )}

        {!decision && needsInput && (
          <Alert
            type="warning"
            showIcon
            message={t('setup.contextNeedsInputTitle')}
            description={terminal?.message ?? t('setup.contextNeedsInputMessage')}
          />
        )}

        {failure && <SetupFailurePanel failure={failure} step="context" retrying={streaming} onRetry={retryContextFailure} />}
        {!failure && error && <Alert type="error" showIcon message={t('setup.contextErrorTitle')} />}
      </Space>
    </Panel>
  );
}
