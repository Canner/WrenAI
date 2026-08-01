import { Typography } from 'antd';
import { PUBLISH_UI_ENABLED } from '@/app/features';
import { EnvelopeView } from '@/envelope/EnvelopeView';
import { Panel } from '@/ui';
import { t } from '@/i18n/strings';
import { ArtifactMeta } from './ArtifactMeta';
import { PublishStatus } from './PublishStatus';
import { SourceLine } from './SourceLine';
import type { ChartArtifact } from './types';

interface Props {
  artifact: ChartArtifact;
  onPublish: () => void;
  onUnpin: () => void;
}

/**
 * Chart artifact: base metadata, publish status, and a single verified
 * result via `EnvelopeView` plus its source.
 *
 * A live-BFF-sourced chart has no persisted envelope (the BFF stores
 * artifact metadata only — see `bff/client.ts`), so `envelope`/`source` are
 * optional; when absent this view omits the chart instead of reading
 * `.blocks` off `undefined`.
 */
export function ChartView({ artifact, onPublish, onUnpin }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ArtifactMeta artifact={artifact} onUnpin={onUnpin} />
      {PUBLISH_UI_ENABLED && <PublishStatus publish={artifact.publish} onPublish={onPublish} />}
      {artifact.envelope ? (
        <Panel note={artifact.source && <SourceLine source={artifact.source} />}>
          <EnvelopeView envelope={artifact.envelope} />
        </Panel>
      ) : (
        <Typography.Text type="secondary">{t('artifacts.detailUnavailableNote')}</Typography.Text>
      )}
    </div>
  );
}
