import { Typography } from 'antd';
import { brand } from '@/app/theme/tokens';
import { PUBLISH_UI_ENABLED } from '@/app/features';
import { EnvelopeView } from '@/envelope/EnvelopeView';
import { Panel } from '@/ui';
import { t } from '@/i18n/strings';
import { ArtifactMeta } from './ArtifactMeta';
import { PublishStatus } from './PublishStatus';
import { SourceLine } from './SourceLine';
import type { ReportArtifact } from './types';

interface Props {
  artifact: ReportArtifact;
  onPublish: () => void;
  onUnpin: () => void;
}

/**
 * Report artifact: base metadata (name/kind/location/verified, via
 * `ArtifactMeta`), publish status (shareable link + access scope, via
 * `PublishStatus`), and a safe preview. A `preview.kind === 'html'` report is
 * NEVER executed inline — it renders as literal, escaped text in a monospace
 * block (no `dangerouslySetInnerHTML` anywhere in this app). An `'envelope'`
 * preview reuses `EnvelopeView` like every other rendered answer.
 *
 * A live-BFF-sourced report has no persisted preview (the BFF stores
 * artifact metadata only — see `bff/client.ts`), so `preview`/`source` are
 * optional; when absent this view omits the preview panel instead of reading
 * `.preview.kind` off `undefined`.
 */
export function ReportView({ artifact, onPublish, onUnpin }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ArtifactMeta artifact={artifact} onUnpin={onUnpin} />
      {PUBLISH_UI_ENABLED && <PublishStatus publish={artifact.publish} onPublish={onPublish} />}

      {artifact.preview ? (
        <Panel
          title={t('artifacts.previewTitle')}
          note={artifact.source && <SourceLine source={artifact.source} />}
        >
          {artifact.preview.kind === 'envelope' ? (
            <EnvelopeView envelope={artifact.preview.envelope} />
          ) : (
            <>
              <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                {t('artifacts.htmlPreviewNote')}
              </Typography.Text>
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  borderRadius: 8,
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: brand.fontFamilyCode,
                  fontSize: 12,
                  background: 'var(--ant-color-fill-quaternary)',
                }}
              >
                <code>{artifact.preview.html}</code>
              </pre>
            </>
          )}
        </Panel>
      ) : (
        <Typography.Text type="secondary">{t('artifacts.detailUnavailableNote')}</Typography.Text>
      )}
    </div>
  );
}
