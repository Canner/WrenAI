import { useEffect, useState } from 'react';
import { Alert, Button, Input, Segmented, Space, Spin, Typography } from 'antd';
import { Panel } from '@/ui';
import { t } from '@/i18n/strings';
import { WorkLog } from '@/session/WorkLog';
import { useSetupStore } from './useSetupStore';
import { fixtureDataSourceOptions } from './fixtures';
import { DecisionCard } from './DecisionCard';

/**
 * Step 2 (Connect data source): pick a data source type, name the project,
 * and connect. In live (BFF) mode this starts a real agentic turn and
 * streams its WorkLog inline; the step only advances once the stream's
 * terminal reports success — never on the click itself. If the agent needs
 * `.env` credentials it cannot supply, the flow pauses with an in-UI
 * credential FORM: one input per field key discovered in the scaffolded
 * `.env` template (secret-shaped keys get a masked `Input.Password`).
 * Submitted values go straight from this form to the BFF's `.env` write —
 * they are never held anywhere else in app state, never logged, and never
 * seen by the agent. If the field list can't be loaded (or comes back
 * empty), the card falls back to the plain "I've filled .env — continue"
 * affordance so the flow can still proceed. In fixture mode (no BFF
 * configured) "Connect" still just marks the step done synchronously, as
 * before.
 */
export function ConnectStepCard() {
  const connectedSourceKey = useSetupStore((s) => s.connectedSourceKey);
  const connectDataSource = useSetupStore((s) => s.connectDataSource);
  const resumeConnect = useSetupStore((s) => s.resumeConnect);
  const fetchConnectEnvFields = useSetupStore((s) => s.fetchConnectEnvFields);
  const submitConnectEnv = useSetupStore((s) => s.submitConnectEnv);
  const resolveConnectDecision = useSetupStore((s) => s.resolveConnectDecision);
  const connectStream = useSetupStore((s) => s.connectStream);
  const [sourceKey, setSourceKey] = useState(
    connectedSourceKey ?? fixtureDataSourceOptions[0].key,
  );
  const [projectName, setProjectName] = useState('');
  // Credential form values live here ONLY until submitted — never routed into
  // the store, a turn prompt, or the SSE stream. See `submitConnectEnv`.
  const [envValues, setEnvValues] = useState<Record<string, string>>({});

  const options = fixtureDataSourceOptions.map((option) => ({
    label: option.label,
    value: option.key,
  }));

  const {
    streaming,
    workLog,
    error,
    needsInput,
    decision,
    envFields,
    envFieldsError,
    envFieldsLoading,
    submittingEnv,
  } = connectStream;

  // Fetch the credential form's field keys as soon as a needs_input pause
  // starts; reset any stale form values from a prior attempt.
  useEffect(() => {
    if (needsInput) {
      setEnvValues({});
      fetchConnectEnvFields();
    }
  }, [needsInput, fetchConnectEnvFields]);
  // While a `needs_input` pause OR a decision checkpoint is active, streaming
  // is already false (the turn/POST that raised it has ended) but the flow is
  // still mid-handoff — the primary Connect controls stay disabled until the
  // pause/decision resolves and its own turn reaches a terminal.
  const inputLocked = streaming || needsInput || Boolean(decision);
  const canSubmit = projectName.trim().length > 0 && !inputLocked;

  const handleDecisionChoice = (choiceId: string) => {
    // Rename re-opens this same form for a NEW name — clear the (conflicting)
    // name eagerly rather than waiting on the POST round-trip.
    if (choiceId === 'rename') setProjectName('');
    resolveConnectDecision(choiceId);
  };

  const note = connectedSourceKey
    ? t('setup.connectedNote')
    : streaming
      ? t('setup.connectingNote')
      : t('setup.connectDescription');

  return (
    <Panel title={t('setup.connectTitle')} note={note}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <label style={{ display: 'block' }}>
          <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>
            {t('setup.connectSourceLabel')}
          </Typography.Text>
          <Segmented
            aria-label={t('setup.connectSourceAriaLabel')}
            value={sourceKey}
            options={options}
            disabled={inputLocked}
            onChange={(value) => setSourceKey(value as string)}
          />
        </label>
        <label style={{ display: 'block' }}>
          <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>
            {t('setup.connectProjectNameLabel')}
          </Typography.Text>
          <Input
            placeholder={t('setup.connectProjectNamePlaceholder')}
            value={projectName}
            disabled={inputLocked}
            onChange={(e) => setProjectName(e.target.value)}
          />
        </label>
        <Button
          type="primary"
          disabled={!canSubmit}
          loading={streaming}
          onClick={() => connectDataSource(projectName.trim(), sourceKey)}
        >
          {t('setup.connectCreateAction')}
        </Button>

        <WorkLog steps={workLog} />

        {decision && (
          <DecisionCard decision={decision} resolving={streaming} onChoose={handleDecisionChoice} />
        )}

        {!decision && needsInput && (
          <Panel title={t('setup.connectNeedsInputTitle')} note={t('setup.connectNeedsInputMessage')}>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              {envFieldsError && (
                <Alert type="warning" showIcon message={envFieldsError} />
              )}
              {envFieldsLoading ? (
                <Spin />
              ) : envFields && envFields.length > 0 ? (
                <>
                  {envFields.map((field) => (
                    <label key={field.key} style={{ display: 'block' }}>
                      <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>
                        {field.key}
                      </Typography.Text>
                      {field.secret ? (
                        <Input.Password
                          value={envValues[field.key] ?? ''}
                          onChange={(e) =>
                            setEnvValues((v) => ({ ...v, [field.key]: e.target.value }))
                          }
                        />
                      ) : (
                        <Input
                          value={envValues[field.key] ?? ''}
                          onChange={(e) =>
                            setEnvValues((v) => ({ ...v, [field.key]: e.target.value }))
                          }
                        />
                      )}
                    </label>
                  ))}
                  <Button
                    type="primary"
                    loading={submittingEnv || streaming}
                    onClick={() => submitConnectEnv(envValues)}
                  >
                    {t('setup.connectEnvSubmitAction')}
                  </Button>
                </>
              ) : (
                // Graceful fallback: no field keys to render (fetch failed, or
                // the template genuinely has none) — let the user continue
                // once they've set credentials another way.
                <Button size="small" onClick={() => resumeConnect()} loading={streaming}>
                  {t('setup.connectResumeAction')}
                </Button>
              )}
            </Space>
          </Panel>
        )}

        {error && (
          <Alert type="error" showIcon message={t('setup.connectErrorTitle')} description={error} />
        )}
      </Space>
    </Panel>
  );
}
