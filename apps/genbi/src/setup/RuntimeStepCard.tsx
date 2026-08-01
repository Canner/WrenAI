import { useEffect } from 'react';
import { Alert, Button, Input, Segmented, Space, Switch } from 'antd';
import { Panel } from '@/ui';
import { t } from '@/i18n/strings';
import { useSetupStore } from './useSetupStore';
import { fixtureModelOptions } from './fixtures';
import type { ApiKeyAdapter, AuthMode, ModelTier } from './types';

const comingSoon = (label: string) => `${label} (${t('setup.runtimeComingSoon')})`;
const unavailable = (label: string) => `${label} (${t('setup.runtimeUnavailable')})`;

// Agentic setup is currently supported only through the persistent Claude
// subscription session. Keep BYO visible so the product boundary is explicit,
// but disabled while its in-process runtime is frozen; Local remains disabled
// until a native-session integration exists.
const authOptions: { label: string; value: AuthMode; disabled?: boolean }[] = [
  { label: t('setup.authSubscription'), value: 'subscription' },
  { label: unavailable(t('setup.authByo')), value: 'byo', disabled: true },
  { label: comingSoon(t('setup.authLocal')), value: 'local', disabled: true },
];

const apiKeyAdapterOptions: { label: string; value: ApiKeyAdapter }[] = [
  { label: t('setup.authByoAdapterAnthropic'), value: 'anthropic' },
  { label: t('setup.authByoAdapterOpenaiCompatible'), value: 'openai-compatible' },
];

/** The env var each adapter self-reads/is injected from — a name, never the value. */
const envVarFor = (adapter: ApiKeyAdapter) => (adapter === 'openai-compatible' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY');

/**
 * True iff `value` parses as an absolute `http:`/`https:` URL. Mirrors the
 * same-named check in `server/app.ts`'s `PUT /api/config/runtime` handler —
 * duplicated rather than shared because that file runs in the BFF, this one
 * in the browser. Kept in sync by hand; if it drifts, the server-side gate
 * still rejects the save, just without the client catching it first.
 */
const isAbsoluteHttpUrl = (value: string): boolean => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

const modelOptions = fixtureModelOptions.map((model) => ({ label: model, value: model }));

const tierRows: { tier: ModelTier; label: string; ariaLabel: string }[] = [
  { tier: 'orchestrator', label: t('setup.tierOrchestrator'), ariaLabel: t('setup.tierModelAriaOrchestrator') },
  { tier: 'strong', label: t('setup.tierStrong'), ariaLabel: t('setup.tierModelAriaStrong') },
  { tier: 'cheap', label: t('setup.tierCheap'), ariaLabel: t('setup.tierModelAriaCheap') },
];

/**
 * Step 1 (Runtime & models): auth/runtime mode and a model per tier
 * (orchestrator/strong/cheap — same `{ tier, model }` shape as the Harness
 * page's `TierModelBinding`, so the two surfaces never drift). There's no
 * deployment choice: the flow always runs as a personal, single-operator
 * subscription (the only combination the compliance gate allows), so instead
 * of a control we just surface the subscription ToS notice. Saving marks this
 * step done and advances the flow to "Connect data source".
 */
export function RuntimeStepCard() {
  const runtimeSettings = useSetupStore((s) => s.runtimeSettings);
  const updateRuntimeSettings = useSetupStore((s) => s.updateRuntimeSettings);
  const saveRuntimeSettings = useSetupStore((s) => s.saveRuntimeSettings);
  const adapterEnvStatus = useSetupStore((s) => s.adapterEnvStatus);
  const runtimeSettingsSaving = useSetupStore((s) => s.runtimeSettingsSaving);
  const runtimeSettingsError = useSetupStore((s) => s.runtimeSettingsError);

  // A persisted runtime choice may predate the UI freeze. Do not leave an
  // unavailable radio selected or allow that stale value to advance setup;
  // migrate only the browser-side draft back to the supported subscription
  // choice. The existing BFF routes and Mode-A implementation stay intact.
  useEffect(() => {
    if (runtimeSettings.authMode !== 'subscription') {
      updateRuntimeSettings({ authMode: 'subscription' });
    }
  }, [runtimeSettings.authMode, updateRuntimeSettings]);

  const setTierModel = (tier: ModelTier, model: string) => {
    const tierModels = runtimeSettings.tierModels.map((binding) =>
      binding.tier === tier ? { ...binding, model } : binding,
    );
    updateRuntimeSettings({ tierModels });
  };

  const selectedAdapter: ApiKeyAdapter = runtimeSettings.apiKeyAdapter ?? 'anthropic';
  const envDetected = selectedAdapter === 'openai-compatible' ? adapterEnvStatus.openaiCompatible : adapterEnvStatus.anthropic;
  const isByo = runtimeSettings.authMode === 'byo';
  const baseUrlRequired = isByo && selectedAdapter === 'openai-compatible';
  const baseUrlMissing = baseUrlRequired && !runtimeSettings.apiKeyBaseURL;
  // A non-empty Base URL that doesn't parse as an absolute http(s) URL is
  // never valid — most often the model/base-URL transposition bug (see
  // `modelLooksLikeUrl` below). Caught here, not just server-side, so Save
  // disables and the offending field is flagged before the round-trip.
  const baseUrlInvalid =
    baseUrlRequired && !!runtimeSettings.apiKeyBaseURL?.trim() && !isAbsoluteHttpUrl(runtimeSettings.apiKeyBaseURL.trim());
  // Neither adapter has a default model (see harness/providers/adapters/*) — a
  // blank value here only surfaces later as a real-SDK failure, so it's
  // required, not optional, whenever BYO is selected.
  const modelMissing = isByo && !runtimeSettings.apiKeyModel?.trim();
  // The other half of the transposition bug: a model value that itself parses
  // as a URL almost always means Model and Base URL were swapped.
  const modelLooksLikeUrl = isByo && !!runtimeSettings.apiKeyModel?.trim() && isAbsoluteHttpUrl(runtimeSettings.apiKeyModel.trim());
  const envMissing = isByo && !envDetected;
  const saveDisabled =
    runtimeSettings.authMode !== 'subscription' ||
    runtimeSettingsSaving ||
    baseUrlMissing ||
    baseUrlInvalid ||
    modelMissing ||
    modelLooksLikeUrl ||
    envMissing;

  return (
    <Panel title={t('setup.runtimeTitle')} note={t('setup.runtimeDescription')}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>{t('setup.authModeLabel')}</div>
          <Segmented
            aria-label={t('setup.authModeAriaLabel')}
            value={runtimeSettings.authMode}
            options={authOptions}
            onChange={(value) => updateRuntimeSettings({ authMode: value as AuthMode })}
          />
          {runtimeSettings.authMode === 'subscription' && (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 8 }}
              message={t('setup.authSubscriptionWarning')}
            />
          )}

          {runtimeSettings.authMode === 'byo' && (
            <div style={{ marginTop: 12 }}>
              <div style={{ marginBottom: 8, fontWeight: 500 }}>{t('setup.authByoAdapterLabel')}</div>
              <Segmented
                aria-label={t('setup.authByoAdapterAriaLabel')}
                value={selectedAdapter}
                options={apiKeyAdapterOptions}
                onChange={(value) => updateRuntimeSettings({ apiKeyAdapter: value as ApiKeyAdapter })}
              />
              <div style={{ marginTop: 8, opacity: 0.65, fontSize: 12 }}>
                {envVarFor(selectedAdapter)} {envDetected ? t('setup.authByoEnvDetected') : t('setup.authByoEnvMissing')}
              </div>

              <div style={{ marginTop: 12 }}>
                <div style={{ marginBottom: 4, fontWeight: 500 }}>{t('setup.authByoModelLabel')}</div>
                <Input
                  status={modelMissing || modelLooksLikeUrl ? 'error' : undefined}
                  value={runtimeSettings.apiKeyModel ?? ''}
                  placeholder={t('setup.authByoModelPlaceholder')}
                  onChange={(e) => updateRuntimeSettings({ apiKeyModel: e.target.value })}
                />
                {modelMissing && (
                  <div style={{ color: '#ff4d4f', fontSize: 12, marginTop: 4 }}>
                    {t('setup.authByoModelRequired')}
                  </div>
                )}
                {modelLooksLikeUrl && (
                  <div style={{ color: '#ff4d4f', fontSize: 12, marginTop: 4 }}>
                    {t('setup.authByoModelLooksLikeUrl')}
                  </div>
                )}
              </div>

              {selectedAdapter === 'openai-compatible' && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ marginBottom: 4, fontWeight: 500 }}>{t('setup.authByoBaseUrlLabel')}</div>
                  <Input
                    status={baseUrlMissing || baseUrlInvalid ? 'error' : undefined}
                    value={runtimeSettings.apiKeyBaseURL ?? ''}
                    placeholder={t('setup.authByoBaseUrlPlaceholder')}
                    onChange={(e) => updateRuntimeSettings({ apiKeyBaseURL: e.target.value })}
                  />
                  {baseUrlMissing && (
                    <div style={{ color: '#ff4d4f', fontSize: 12, marginTop: 4 }}>
                      {t('setup.authByoBaseUrlRequired')}
                    </div>
                  )}
                  {baseUrlInvalid && (
                    <div style={{ color: '#ff4d4f', fontSize: 12, marginTop: 4 }}>
                      {t('setup.authByoBaseUrlInvalid')}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>{t('setup.tierModelsLabel')}</div>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {tierRows.map((row) => {
              const binding = runtimeSettings.tierModels.find((b) => b.tier === row.tier);
              return (
                <div key={row.tier} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ width: 100, opacity: 0.65 }}>{row.label}</span>
                  <Segmented
                    aria-label={row.ariaLabel}
                    value={binding?.model}
                    options={modelOptions}
                    onChange={(value) => setTierModel(row.tier, value as string)}
                  />
                </div>
              );
            })}
          </Space>
        </div>

        {/* Hybrid routing isn't wired into the setup flow yet — greyed until it is. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: 0.5 }}>
          <Switch
            aria-label={t('setup.hybridLabel')}
            checked={runtimeSettings.hybrid}
            disabled
            onChange={(checked) => updateRuntimeSettings({ hybrid: checked })}
          />
          <div>
            <div style={{ fontWeight: 500 }}>{comingSoon(t('setup.hybridLabel'))}</div>
            <div style={{ opacity: 0.65, fontSize: 12 }}>{t('setup.hybridDescription')}</div>
          </div>
        </div>

        {runtimeSettingsError && (
          <Alert type="error" showIcon message={t('setup.runtimeSaveErrorTitle')} description={runtimeSettingsError} />
        )}

        <Button type="primary" disabled={saveDisabled} onClick={saveRuntimeSettings}>
          {runtimeSettingsSaving ? t('setup.savingRuntime') : t('setup.saveRuntime')}
        </Button>
      </Space>
    </Panel>
  );
}
