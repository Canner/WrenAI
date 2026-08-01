import { useEffect } from 'react';
import { PageContainer, PageState } from '@/ui';
import { t } from '@/i18n/strings';
import { isBffEnabled } from '@/bff/env';
import { useArtifactsStore } from './useArtifactsStore';
import { DashboardView } from './DashboardView';
import { ReportView } from './ReportView';
import { ChartView } from './ChartView';

/**
 * Artifacts page canvas: the selected artifact's per-kind detail (dashboard /
 * report / chart) — see `ArtifactsSidebar` for how one is selected. With no
 * `VITE_BFF_URL` set, artifacts come entirely from fixtures; when the BFF is
 * enabled, `loadArtifacts` fetches the list and `select` lazily hydrates
 * per-kind detail (mirrors `EvalPage`/`useEvalStore`).
 */
export function ArtifactsPage() {
  const selectedKey = useArtifactsStore((s) => s.selectedKey);
  const summaries = useArtifactsStore((s) => s.summaries);
  const detailsByKey = useArtifactsStore((s) => s.detailsByKey);
  const loadArtifacts = useArtifactsStore((s) => s.loadArtifacts);
  const select = useArtifactsStore((s) => s.select);
  const publish = useArtifactsStore((s) => s.publish);
  const unpin = useArtifactsStore((s) => s.unpin);
  const error = useArtifactsStore((s) => s.error);
  const detailError = useArtifactsStore((s) => s.detailError);

  useEffect(() => {
    loadArtifacts();
  }, [loadArtifacts]);

  const live = isBffEnabled();
  const summary = summaries.find((a) => a.key === selectedKey);
  const detail = detailsByKey[selectedKey];

  let body;
  if (live && error) {
    body = <PageState status="error" title={t('artifacts.loadErrorTitle')} description={error} onRetry={loadArtifacts} />;
  } else if (!summary) {
    body = (
      <PageState status="empty" title={t('artifacts.emptyTitle')} description={t('artifacts.emptyDescription')} />
    );
  } else if (live && detailError && !detail) {
    body = (
      <PageState
        status="error"
        title={t('artifacts.detailErrorTitle')}
        description={detailError}
        onRetry={() => select(selectedKey)}
      />
    );
  } else if (!detail) {
    body = <PageState status="loading" />;
  } else if (detail.kind === 'dashboard') {
    body = <DashboardView artifact={detail} onPublish={() => publish(detail.key)} onUnpin={() => unpin(detail.key)} />;
  } else if (detail.kind === 'report') {
    body = <ReportView artifact={detail} onPublish={() => publish(detail.key)} onUnpin={() => unpin(detail.key)} />;
  } else {
    body = <ChartView artifact={detail} onPublish={() => publish(detail.key)} onUnpin={() => unpin(detail.key)} />;
  }

  return (
    <PageContainer maxWidth={1000} title={t('nav.artifacts')} lead={t('artifacts.pageLead')}>
      {body}
    </PageContainer>
  );
}
