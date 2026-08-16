import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { PageContainer } from '@/ui';
import { t } from '@/i18n/strings';
import { useContextStore } from './useContextStore';
import { Overview } from './Overview';
import { FileViewer } from './FileViewer';
import { ImpactView } from './ImpactView';

/**
 * Context page canvas: a read-only status view over the semantic layer. The
 * active view (`overview` / `file` / `impact`) is driven by `useContextStore`
 * — see the sidebar (file tree) and the "View impact" actions in `Overview`
 * and `FileViewer` for how a view transition is triggered. Live mode fetches
 * the semantic overview and file tree from the BFF on mount (mirrors
 * `HarnessPage`'s `loadHarness` on-mount fetch) — a no-op in fixture mode.
 */
export function ContextPage() {
  const viewMode = useContextStore((s) => s.viewMode);
  const loadOverview = useContextStore((s) => s.loadOverview);
  const loadFiles = useContextStore((s) => s.loadFiles);
  const loadEnrichment = useContextStore((s) => s.loadEnrichment);
  const refreshCanonical = useContextStore((s) => s.refreshCanonical);
  const location = useLocation();

  useEffect(() => {
    if (location.state?.nativeSessionReturn === 'context') refreshCanonical();
    else { loadOverview(); loadFiles(); loadEnrichment(); }
  }, [loadOverview, loadFiles, loadEnrichment, location.state, refreshCanonical]);

  let body;
  if (viewMode === 'file') body = <FileViewer />;
  else if (viewMode === 'impact') body = <ImpactView />;
  else body = <Overview />;

  return (
    <PageContainer maxWidth={1180} title={t('nav.context')} lead={t('context.pageLead')}>
      {body}
    </PageContainer>
  );
}
