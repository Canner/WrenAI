import { useEffect } from 'react';
import { PageContainer, PageState } from '@/ui';
import { t } from '@/i18n/strings';
import { isBffEnabled } from '@/bff/env';
import { useHarnessStore } from './useHarnessStore';
import { fixtureHarnessViews } from './fixtures';
import { HarnessOverview } from './HarnessOverview';

/**
 * Harness page canvas: a single scrollable status view over how the bound
 * profile is realized — components, capability resolution, model bindings,
 * with technical diagnostics available on demand (see `HarnessOverview`).
 * Fixture mode (no `VITE_BFF_URL`) renders the fixture bundle; live mode
 * fetches the selected purpose from the BFF on mount.
 */
export function HarnessPage() {
  const selectedPurpose = useHarnessStore((s) => s.selectedPurpose);
  const harness = useHarnessStore((s) => s.harness);
  const loading = useHarnessStore((s) => s.loading);
  const error = useHarnessStore((s) => s.error);
  const loadHarness = useHarnessStore((s) => s.loadHarness);

  useEffect(() => {
    loadHarness();
  }, [loadHarness]);

  const live = isBffEnabled();
  const view = live ? harness : fixtureHarnessViews[selectedPurpose];

  let body;
  if (live && loading && !harness) {
    body = <PageState status="loading" />;
  } else if (live && error && !harness) {
    body = (
      <PageState status="error" title={t('harness.loadErrorTitle')} description={error} onRetry={loadHarness} />
    );
  } else if (view && view.purpose.purpose === selectedPurpose) {
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
    >
      {body}
    </PageContainer>
  );
}
