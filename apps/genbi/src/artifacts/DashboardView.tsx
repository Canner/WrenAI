import { Typography } from 'antd';
import { PUBLISH_UI_ENABLED } from '@/app/features';
import { EnvelopeView } from '@/envelope/EnvelopeView';
import { Panel } from '@/ui';
import { t } from '@/i18n/strings';
import { ArtifactMeta } from './ArtifactMeta';
import { PublishStatus } from './PublishStatus';
import { SourceLine } from './SourceLine';
import type { DashboardArtifact } from './types';

interface Props {
  artifact: DashboardArtifact;
  onPublish: () => void;
  onUnpin: () => void;
}

/**
 * Dashboard artifact: base metadata (`ArtifactMeta`), publish status, and
 * either a plain CSS grid of verified fixture tiles (each its own render
 * envelope via `EnvelopeView`, so every tile gets its own verified badge,
 * plus a source attribution line) or a single envelope for a live dashboard.
 * No drag/resize library — Phase 1 is read-only display.
 *
 * A live dashboard's persisted content is one flat `blocks` array with no
 * per-tile title/source, so it's never split into fabricated tiles — `tiles`
 * stays fixture-only, and a live dashboard instead renders its whole
 * `envelope` as a single unlabeled panel, mirroring `ChartView`. When
 * neither is present (server-sourced but content wasn't readable) this view
 * omits both and falls back to the "detail unavailable" note.
 */
export function DashboardView({ artifact, onPublish, onUnpin }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ArtifactMeta artifact={artifact} onUnpin={onUnpin} />
      {PUBLISH_UI_ENABLED && <PublishStatus publish={artifact.publish} onPublish={onPublish} />}
      {artifact.tiles && artifact.tiles.length > 0 ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 16,
          }}
        >
          {artifact.tiles.map((tile) => (
            <Panel key={tile.key} title={tile.title} note={<SourceLine source={tile.source} />}>
              <EnvelopeView envelope={tile.envelope} />
            </Panel>
          ))}
        </div>
      ) : artifact.envelope ? (
        <Panel>
          <EnvelopeView envelope={artifact.envelope} />
        </Panel>
      ) : (
        <Typography.Text type="secondary">{t('artifacts.detailUnavailableNote')}</Typography.Text>
      )}
    </div>
  );
}
