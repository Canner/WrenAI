import { Button } from 'antd';
import { PushpinOutlined } from '@ant-design/icons';
import { KVRow, Panel, StatusTag, verifiedStateOf } from '@/ui';
import { t } from '@/i18n/strings';
import type { Artifact, ArtifactKind } from './types';

const KIND_LABEL: Record<ArtifactKind, string> = {
  dashboard: t('artifacts.kindDashboard'),
  report: t('artifacts.kindReport'),
  chart: t('artifacts.kindChart'),
};

interface Props {
  artifact: Artifact;
  onUnpin: () => void;
}

/**
 * Base metadata every artifact detail view renders regardless of kind: name,
 * kind, file location, and verified state. These are exactly the fields the
 * live BFF's `ArtifactDto` carries (see `bff/client.ts`), so this panel is
 * always safe to render — even for a metadata-only artifact whose rich
 * per-kind content (tiles/preview/envelope) hasn't been persisted. Each
 * per-kind view (`DashboardView`/`ReportView`/`ChartView`) renders that rich
 * content separately, and only when present.
 *
 * Also renders the Unpin action, shared across all three artifact kinds
 * (rather than duplicated per view). Placed here rather than in
 * `PublishStatus` because this panel renders unconditionally — Unpin must
 * work regardless of the (currently hidden) publish/share UI.
 */
export function ArtifactMeta({ artifact, onUnpin }: Props) {
  return (
    <Panel
      title={artifact.name}
      extra={
        <Button size="small" icon={<PushpinOutlined />} onClick={onUnpin}>
          {t('artifacts.unpin')}
        </Button>
      }
    >
      <KVRow label={t('artifacts.kindLabel')} value={KIND_LABEL[artifact.kind]} />
      <KVRow label={t('artifacts.fileLocation')} value={<code>{artifact.location}</code>} />
      <KVRow
        label={t('artifacts.statusLabel')}
        value={<StatusTag state={verifiedStateOf(artifact.verified)} />}
      />
    </Panel>
  );
}
