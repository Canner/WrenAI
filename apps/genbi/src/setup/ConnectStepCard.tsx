import { useEffect, useState } from 'react';
import { Alert, Button, Input, Select, Space, Spin, Typography } from 'antd';
import { Panel } from '@/ui';
import { t } from '@/i18n/strings';
import { WorkLog } from '@/session/WorkLog';
import type { SetupEnvField } from '@/bff/client';
import { useSetupStore } from './useSetupStore';
import { fixtureDataSourceOptions } from './fixtures';


/**
 * A field wren wants as base64 of a file — BigQuery's service-account JSON is
 * the one that prompted this. Pasting a base64 blob means the user has to run
 * `base64 credentials.json` themselves and paste the result into a password box
 * they cannot read back, so this takes the file and encodes it here.
 *
 * The bytes never leave the same path a typed value would: browser form ->
 * POST /api/setup/connect/env -> the project's .env on disk. Nothing is written
 * to app state beyond this form.
 */
function CredentialFileInput({ field, value, onChange }: { field: SetupEnvField; value: string; onChange: (next: string) => void }) {
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const readAsBase64 = (file: File) => {
    const reader = new FileReader();
    reader.onerror = () => setError(t('setup.connectCredentialFileError'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        setError(t('setup.connectCredentialFileError'));
        return;
      }
      // A data: URL is `data:<mime>;base64,<payload>` — take the payload.
      const comma = result.indexOf(',');
      setError(undefined);
      setFileName(file.name);
      onChange(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <Space direction="vertical" size={6} style={{ width: '100%' }}>
      <input
        type="file"
        accept="application/json,.json"
        aria-label={`${field.label ?? field.key} file`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) readAsBase64(file);
        }}
      />
      {fileName && !error && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {t('setup.connectCredentialFileEncoded')}{fileName}
        </Typography.Text>
      )}
      {error && <Alert type="error" showIcon message={error} />}
      {/* Still typable: a user who already has the base64 string, or whose
          credential is not a file at all, is not forced through the picker. */}
      <Input.Password
        placeholder={t('setup.connectCredentialPastePlaceholder')}
        value={value}
        onChange={(e) => {
          setFileName(undefined);
          onChange(e.target.value);
        }}
      />
    </Space>
  );
}

/** Stable default so the preselected source never depends on catalog ordering. */
const DEFAULT_SOURCE_KEY = 'postgres';
import { DecisionCard } from './DecisionCard';
import { SetupFailurePanel } from './SetupFailurePanel';

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
  const retryConnectFailure = useSetupStore((s) => s.retryConnectFailure);
  const connectStream = useSetupStore((s) => s.connectStream);
  const sourceCatalog = useSetupStore((s) => s.sourceCatalog);
  const sourceCatalogDegradedReason = useSetupStore((s) => s.sourceCatalogDegradedReason);
  const sourceCatalogLoading = useSetupStore((s) => s.sourceCatalogLoading);
  const fetchSourceCatalog = useSetupStore((s) => s.fetchSourceCatalog);
  // `DEFAULT_SOURCE_KEY` rather than the first entry of whatever list happens
  // to load: the live catalog's order is wren's, and a default that moves when
  // an unrelated connector is added is a silent behaviour change.
  const [sourceKey, setSourceKey] = useState(connectedSourceKey ?? DEFAULT_SOURCE_KEY);
  const [variant, setVariant] = useState<string | undefined>(undefined);
  const [projectName, setProjectName] = useState('');
  // Credential form values live here ONLY until submitted — never routed into
  // the store, a turn prompt, or the SSE stream. See `submitConnectEnv`.
  const [envValues, setEnvValues] = useState<Record<string, string>>({});

  // Live catalog when the BFF is wired; the fixture list is fixture mode only.
  const options = (sourceCatalog.length > 0 ? sourceCatalog : fixtureDataSourceOptions.map((option) => ({ key: option.key, label: option.label }))).map(
    (source) => ({ label: source.label, value: source.key }),
  );

  // Shapes this source can be connected in. Sources with more than one — the
  // BigQuery dataset/project split, Redshift password/IAM, Databricks
  // token/service-principal — need the choice made here; it used to be left to
  // whichever one the agent happened to write into the .env template.
  const variantOptions = (sourceCatalog.find((source) => source.key === sourceKey)?.variants ?? [])
    .flatMap((entry) => (entry.discriminator ? [entry.discriminator.value] : []));

  useEffect(() => {
    setVariant(variantOptions.length > 1 ? variantOptions[0] : undefined);
    // Re-derived whenever the source (or the loaded catalog) changes.
  }, [sourceKey, sourceCatalog]);

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
    failure,
  } = connectStream;

  useEffect(() => {
    fetchSourceCatalog();
  }, [fetchSourceCatalog]);

  useEffect(() => {
    if (!failure) return;
    setProjectName(failure.projectName);
    setSourceKey(failure.sourceType);
  }, [failure]);

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
          <Select
            aria-label={t('setup.connectSourceAriaLabel')}
            showSearch
            value={sourceKey}
            options={options}
            loading={sourceCatalogLoading}
            disabled={inputLocked}
            placeholder={t('setup.connectSourcePlaceholder')}
            style={{ width: '100%', maxWidth: 420 }}
            optionFilterProp="label"
            getPopupContainer={(trigger) => trigger.parentElement ?? document.body}
            onChange={(value: string) => setSourceKey(value)}
          />
          {variantOptions.length > 1 && (
            <div style={{ marginTop: 12 }}>
              <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>
                {t('setup.connectVariantLabel')}
              </Typography.Text>
              <Select
                aria-label={t('setup.connectVariantLabel')}
                value={variant}
                options={variantOptions.map((value) => ({ label: value, value }))}
                disabled={inputLocked}
                style={{ width: '100%', maxWidth: 420 }}
                getPopupContainer={(trigger) => trigger.parentElement ?? document.body}
                onChange={(value: string) => setVariant(value)}
              />
              <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
                {t('setup.connectVariantHint')}
              </Typography.Text>
            </div>
          )}
          {sourceCatalogDegradedReason && (
            <div role="status" style={{ color: '#ad6800', fontSize: 12, marginTop: 4 }}>
              {sourceCatalogDegradedReason}
            </div>
          )}
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
          onClick={() => connectDataSource(projectName.trim(), sourceKey, variant)}
        >
          {t('setup.connectCreateAction')}
        </Button>

        {!failure && <WorkLog steps={workLog} />}

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
                      <Typography.Text strong style={{ display: 'block' }}>
                        {field.label ?? field.key}
                        {field.required === false && (
                          <Typography.Text type="secondary" style={{ fontWeight: 400 }}>{t('setup.connectFieldOptional')}</Typography.Text>
                        )}
                      </Typography.Text>
                      {/* The raw key still matters: it is what lands in .env, and
                          the user may be reading a provider's own docs against it. */}
                      <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                        {field.key}
                      </Typography.Text>
                      {field.description && (
                        <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>
                          {field.description}
                        </Typography.Text>
                      )}
                      <div style={{ marginTop: 6 }}>
                        {field.fixedValue !== undefined ? (
                          // wren fixes this value for the chosen connection shape
                          // (BigQuery's `bigquery_type`, for one). Asking for it
                          // invites a wrong guess, so show it and submit it.
                          <Input value={field.fixedValue} disabled aria-label={field.label ?? field.key} />
                        ) : field.fileEncoded ? (
                          <CredentialFileInput
                            field={field}
                            value={envValues[field.key] ?? ''}
                            onChange={(next) => setEnvValues((v) => ({ ...v, [field.key]: next }))}
                          />
                        ) : field.secret ? (
                          <Input.Password
                            placeholder={field.example}
                            value={envValues[field.key] ?? ''}
                            onChange={(e) =>
                              setEnvValues((v) => ({ ...v, [field.key]: e.target.value }))
                            }
                          />
                        ) : (
                          <Input
                            placeholder={field.example ?? field.defaultValue}
                            value={envValues[field.key] ?? ''}
                            onChange={(e) =>
                              setEnvValues((v) => ({ ...v, [field.key]: e.target.value }))
                            }
                          />
                        )}
                      </div>
                    </label>
                  ))}
                  <Button
                    type="primary"
                    loading={submittingEnv || streaming}
                    onClick={() =>
                      submitConnectEnv({
                        ...Object.fromEntries(
                          (envFields ?? []).flatMap((field) => (field.fixedValue !== undefined ? [[field.key, field.fixedValue]] : [])),
                        ),
                        ...envValues,
                      })
                    }
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

        {failure && <SetupFailurePanel failure={failure} step="connect" retrying={streaming} onRetry={retryConnectFailure} />}
        {!failure && error && <Alert type="error" showIcon message={t('setup.connectErrorTitle')} />}
      </Space>
    </Panel>
  );
}
