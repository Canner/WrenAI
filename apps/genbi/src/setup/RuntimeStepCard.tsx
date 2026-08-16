import { useState } from 'react';
import { Alert, AutoComplete, Button, Input, Segmented, Space } from 'antd';
import { Panel } from '@/ui';
import { t } from '@/i18n/strings';
import { useSetupStore } from './useSetupStore';
import { CLAUDE_TIER_MODELS } from './claude-tier-models';
import type { AuthMode, SubscriptionModelCatalog, SubscriptionProvider, TierModelSelection } from './types';

const authOptions: { label: string; value: AuthMode; disabled?: boolean }[] = [
  { label: t('setup.authSubscription'), value: 'subscription' },
  { label: t('setup.authByo'), value: 'byo', disabled: true },
  { label: t('setup.authLocal'), value: 'local', disabled: true },
];

const subscriptionProviderOptions: { label: string; value: SubscriptionProvider }[] = [
  { label: 'Claude CLI', value: 'claude' },
  { label: 'Codex CLI', value: 'codex' },
];

const isAbsoluteHttpUrl = (value: string): boolean => {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

interface ModelInputProps {
  label: string;
  value: string;
  placeholder: string;
  catalog?: SubscriptionModelCatalog;
  /**
   * Restricts the suggestions to a closed set the consumer will actually accept.
   * Without it the account catalog is offered as-is, which is right for a field
   * that takes any concrete model id and wrong for one that does not.
   */
  allowedModels?: readonly string[];
  onChange: (value: string) => void;
}

/** Catalog suggestions enhance, but never constrain, a free-text model id field. */
function ModelInput({ label, value, placeholder, catalog, allowedModels, onChange }: ModelInputProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const catalogEntry = (id: string) =>
    catalog?.status === 'ready' ? catalog.models.find((model) => model.model.trim() === id) : undefined;
  // A restricted field describes itself from the closed set, borrowing the
  // catalog's copy only where an id happens to appear there. An id the account
  // cannot see is still offered: the consumer accepts it, and that is the only
  // authority that matters here.
  const allOptions = allowedModels
    ? allowedModels.map((id) => {
        const entry = catalogEntry(id);
        return {
          value: id,
          searchText: `${entry?.displayName ?? id} ${id} ${entry?.description ?? ''}`.toLowerCase(),
          label: (
            <div>
              <div style={{ fontWeight: 500 }}>{entry?.displayName ?? id}</div>
              <div style={{ opacity: 0.7, fontSize: 12 }}>{id}</div>
              {entry?.description && <div style={{ opacity: 0.7, fontSize: 12 }}>{entry.description}</div>}
            </div>
          ),
        };
      })
    : catalog?.status === 'ready'
    ? catalog.models.map((model) => ({
        value: model.model,
        searchText: `${model.displayName} ${model.model} ${model.description ?? ''}`.toLowerCase(),
        label: (
          <div>
            <div style={{ fontWeight: 500 }}>{model.displayName}{model.isDefault ? ` · ${t('setup.subscriptionModelDefault')}` : ''}</div>
            <div style={{ opacity: 0.7, fontSize: 12 }}>{model.model}</div>
            {model.description && <div style={{ opacity: 0.7, fontSize: 12 }}>{model.description}</div>}
          </div>
        ),
      }))
    : [];
  const options = allOptions.filter((option) => option.searchText.includes(query.toLowerCase()));
  // The catalog is account-specific and intentionally non-authoritative. Only
  // call a value unverified when this provider's complete ready response does
  // not report it; loading or unavailable responses cannot establish that.
  const normalizedValue = value.trim();
  // On a restricted field this is not a soft "we couldn't verify it" — the save
  // will be rejected — so say so before the user presses the button.
  const outsideAllowed = allowedModels ? normalizedValue.length > 0 && !allowedModels.includes(normalizedValue) : false;
  const customUnverified = !allowedModels
    && normalizedValue.length > 0
    && catalog?.status === 'ready'
    && !catalog.models.some((model) => model.model.trim() === normalizedValue);
  return (
    <>
      <AutoComplete
        aria-label={label}
        value={value}
        options={options}
        open={open && options.length > 0}
        defaultActiveFirstOption
        getPopupContainer={(trigger) => trigger.parentElement ?? document.body}
        filterOption={false}
        onFocus={() => { setQuery(value); setOpen(true); }}
        onOpenChange={setOpen}
        onSearch={(next) => { setQuery(next); setOpen(true); }}
        onChange={onChange}
        onSelect={(next) => { setQuery(next); setOpen(false); onChange(next); }}
      >
        <Input aria-label={label} placeholder={placeholder} />
      </AutoComplete>
      {customUnverified && <div role="status" style={{ color: '#ad6800', fontSize: 12, marginTop: 4 }}>{t('setup.subscriptionModelCustomUnverified')}</div>}
      {outsideAllowed && <div role="alert" style={{ color: '#a8071a', fontSize: 12, marginTop: 4 }}>{t('setup.tierModelOutsideUnion')}{allowedModels?.join(', ')}</div>}
    </>
  );
}

/** Runtime configuration is bundle-tier-driven; dispatcher driver is separate. */
export function RuntimeStepCard() {
  const runtimeSettings = useSetupStore((s) => s.runtimeSettings);
  const runtimeTierNames = useSetupStore((s) => s.runtimeTierNames);
  const runtimeTierNamesError = useSetupStore((s) => s.runtimeTierNamesError);
  const updateRuntimeSettings = useSetupStore((s) => s.updateRuntimeSettings);
  const selectSubscriptionProvider = useSetupStore((s) => s.selectSubscriptionProvider);
  const loadSubscriptionModelCatalog = useSetupStore((s) => s.loadSubscriptionModelCatalog);
  const subscriptionModelCatalogs = useSetupStore((s) => s.subscriptionModelCatalogs);
  const subscriptionModelCatalogLoading = useSetupStore((s) => s.subscriptionModelCatalogLoading);
  const subscriptionModelCatalogErrors = useSetupStore((s) => s.subscriptionModelCatalogErrors);
  const saveRuntimeSettings = useSetupStore((s) => s.saveRuntimeSettings);
  const subscriptionLoginStatus = useSetupStore((s) => s.subscriptionLoginStatus);
  const runtimeSettingsSaving = useSetupStore((s) => s.runtimeSettingsSaving);
  const runtimeSettingsError = useSetupStore((s) => s.runtimeSettingsError);

  const subscriptionProvider: SubscriptionProvider = runtimeSettings.subscriptionProvider ?? 'claude';
  const catalog = subscriptionModelCatalogs[subscriptionProvider];
  const catalogLoading = subscriptionModelCatalogLoading[subscriptionProvider] ?? false;
  const catalogError = subscriptionModelCatalogErrors[subscriptionProvider];
  const bindingFor = (tier: string): TierModelSelection => runtimeSettings.tierModels.find((entry) => entry.tier === tier) ?? { tier };
  const updateTier = (tier: string, patch: Partial<TierModelSelection>) => {
    const existing = bindingFor(tier);
    const tierModels = runtimeSettings.tierModels.some((entry) => entry.tier === tier)
      ? runtimeSettings.tierModels.map((entry) => (entry.tier === tier ? { ...entry, ...patch } : entry))
      : [...runtimeSettings.tierModels, { ...existing, ...patch }];
    updateRuntimeSettings({ tierModels });
  };

  const rowsValid = runtimeTierNames.length > 0 && runtimeTierNames.every((tier) => {
    const binding = bindingFor(tier);
    const model = binding.model?.trim();
    return !!model && !isAbsoluteHttpUrl(model);
  });
  const subscriptionLoggedIn = subscriptionLoginStatus[subscriptionProvider];
  const saveDisabled = runtimeSettingsSaving || !rowsValid ||
    !subscriptionLoggedIn || !runtimeSettings.subscriptionDriverModel?.trim();

  return (
    <Panel title={t('setup.runtimeTitle')} note={t('setup.runtimeDescription')}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <div>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>{t('setup.authModeLabel')}</div>
          {/* Setup is subscription-only. Do not overwrite an unsaved BYO/local boot binding merely to project this form. */}
          <Segmented aria-label={t('setup.authModeAriaLabel')} value={'subscription' as AuthMode} options={authOptions} onChange={() => {}} />
        </div>

        <>
          <div>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>Interactive CLI target</div>
            <Segmented aria-label="Interactive CLI target" value={subscriptionProvider} options={subscriptionProviderOptions} onChange={(value) => selectSubscriptionProvider(value as SubscriptionProvider)} />
            <Alert style={{ marginTop: 8 }} type={subscriptionLoggedIn ? 'warning' : 'error'} showIcon message={subscriptionLoggedIn ? subscriptionProvider === 'codex' ? t('setup.authCodexSubscriptionWarning') : t('setup.authSubscriptionWarning') : t('setup.authSubscriptionLoggedOut')} />
          </div>
          <div>
            <Space align="center" style={{ marginBottom: 4 }}>
              <span style={{ fontWeight: 500 }}>{t('setup.subscriptionModelsLabel')}</span>
              <Button size="small" loading={catalogLoading} onClick={() => loadSubscriptionModelCatalog(subscriptionProvider, true)}>{t('setup.subscriptionModelsRefresh')}</Button>
            </Space>
            {catalogError && <Alert style={{ marginBottom: 8 }} type="warning" showIcon message={t('setup.subscriptionModelsUnavailable')} description={`${catalogError}. ${t('setup.subscriptionModelsFreeTextHint')}`} />}
            {!catalogError && <div style={{ opacity: 0.65, fontSize: 12, marginBottom: 8 }}>{t('setup.subscriptionModelsSignedInHint')}</div>}
            <div style={{ marginBottom: 4, fontWeight: 500 }}>{t('setup.subscriptionDriverModelLabel')}</div>
            <ModelInput label={t('setup.subscriptionDriverModelLabel')} value={runtimeSettings.subscriptionDriverModel ?? ''} placeholder={t('setup.subscriptionModelPlaceholder')} catalog={catalog} onChange={(subscriptionDriverModel) => updateRuntimeSettings({ subscriptionDriverModel })} />
            <div style={{ opacity: 0.65, fontSize: 12, marginTop: 4 }}>{t('setup.subscriptionDriverModelHint')}</div>
          </div>
        </>

        <div>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>{t('setup.compiledTiersLabel')}</div>
          {runtimeTierNamesError && <Alert style={{ marginBottom: 8 }} type="error" showIcon message={t('setup.tierDiscoveryErrorTitle')} description={runtimeTierNamesError} />}
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {runtimeTierNames.map((tier) => {
              const binding = bindingFor(tier);
              const label = `${t('setup.tierModelAriaPrefix')} ${tier} tier`;
              return <div key={tier} style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: 12 }}>
                <div style={{ fontWeight: 500, marginBottom: 8 }}>{tier}</div>
                <ModelInput label={label} value={binding.model ?? ''} placeholder={t('setup.tierModelPlaceholder')} catalog={catalog} allowedModels={subscriptionProvider === 'claude' ? CLAUDE_TIER_MODELS : undefined} onChange={(model) => updateTier(tier, { model })} />
              </div>;
            })}
          </Space>
        </div>

        {runtimeSettingsError && <Alert type="error" showIcon message={t('setup.runtimeSaveErrorTitle')} description={runtimeSettingsError} />}
        <Button type="primary" disabled={saveDisabled} onClick={saveRuntimeSettings}>{runtimeSettingsSaving ? t('setup.savingRuntime') : t('setup.saveRuntime')}</Button>
      </Space>
    </Panel>
  );
}
