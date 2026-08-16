import { Typography } from 'antd';
import { Panel } from '@/ui';
import { t } from '@/i18n/strings';
import { PurposeSessionLaunch } from '@/sessions/PurposeSessionLaunch';

/**
 * Enrichment now hands the operator to the vendor's real interactive CLI.
 * The legacy proposal ledger remains available through its existing BFF
 * routes for compatibility, but it is deliberately not this page's primary
 * accept/edit/approve workflow.
 */
export function EnrichmentPanel() {
  return <Panel title={t('context.enrichmentTitle')}>
    <PurposeSessionLaunch
      purpose="context_enrichment"
      title="Enrich context with a native session"
      lead="Continue in the Sessions workbench. The server fences this session to the current bound project generation and revision."
      returnSource="context"
    />
    <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
      Existing enrichment ledger and canonicalization routes remain available for compatibility.
    </Typography.Paragraph>
  </Panel>;
}
