import { useEffect } from 'react';
import { Button, Tooltip } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { PageContainer, PageState } from '@/ui';
import { t } from '@/i18n/strings';
import { isBffEnabled } from '@/bff/env';
import { BOUND_PROFILE_KEY, useHarnessStore } from './useHarnessStore';
import { fixtureHarnessView } from './fixtures';
import { HarnessOverview } from './HarnessOverview';

/**
 * Harness page canvas: a single scrollable status view over how the bound
 * profile is realized — components, capability resolution, model bindings,
 * and the compiled bundle behind every answer (see `HarnessOverview`).
 * Fixture mode (no `VITE_BFF_URL`) renders the fixture bundle exactly as
 * before; live mode fetches the harness from the BFF on mount. Re-compile /
 * Add profile are Phase-3 affordances and render disabled.
 */
export function HarnessPage() {
  const selectedProfileKey = useHarnessStore((s) => s.selectedProfileKey);
  const harness = useHarnessStore((s) => s.harness);
  const loading = useHarnessStore((s) => s.loading);
  const error = useHarnessStore((s) => s.error);
  const loadHarness = useHarnessStore((s) => s.loadHarness);

  useEffect(() => {
    loadHarness();
  }, [loadHarness]);

  const live = isBffEnabled();
  const view = live ? harness : fixtureHarnessView;

  let body;
  if (live && loading && !harness) {
    body = <PageState status="loading" />;
  } else if (live && error && !harness) {
    body = (
      <PageState status="error" title={t('harness.loadErrorTitle')} description={error} onRetry={loadHarness} />
    );
  } else if (view && selectedProfileKey === BOUND_PROFILE_KEY) {
    body = <HarnessOverview harness={view} />;
  } else {
    body = (
      <PageState status="empty" title={t('harness.emptyTitle')} description={t('harness.emptyDescription')} />
    );
  }

  return (
    <PageContainer
      maxWidth={1000}
      title={t('nav.harness')}
      lead={t('harness.pageSubtitle')}
      actions={
        <>
          <Tooltip title={t('harness.outOfScopeHint')}>
            <Button icon={<ReloadOutlined />} disabled>
              {t('harness.recompile')}
            </Button>
          </Tooltip>
          <Tooltip title={t('harness.outOfScopeHint')}>
            <Button icon={<PlusOutlined />} disabled>
              {t('harness.addProfile')}
            </Button>
          </Tooltip>
        </>
      }
    >
      {body}
    </PageContainer>
  );
}
