import type { ReactNode } from 'react';
import { Tag } from 'antd';
import {
  AppstoreOutlined,
  BarChartOutlined,
  FileTextOutlined,
  MinusCircleOutlined,
  ShareAltOutlined,
} from '@ant-design/icons';
import { StatusTag, verifiedStateOf } from '@/ui';
import { brand } from '@/app/theme/tokens';
import { t } from '@/i18n/strings';
import { useArtifactsStore } from './useArtifactsStore';
import type { ArtifactKind } from './types';
import './artifactsSidebar.css';

const KIND_ICON: Record<ArtifactKind, ReactNode> = {
  dashboard: <AppstoreOutlined />,
  report: <FileTextOutlined />,
  chart: <BarChartOutlined />,
};

const KIND_LABEL: Record<ArtifactKind, string> = {
  dashboard: t('artifacts.kindDashboard'),
  report: t('artifacts.kindReport'),
  chart: t('artifacts.kindChart'),
};

/** Shared/published indicator — always icon + label, never color alone (same
 * non-color a11y convention as `StatusTag`). */
function SharedTag({ shared }: { shared: boolean }) {
  return (
    <Tag
      color={shared ? brand.verified : 'default'}
      icon={shared ? <ShareAltOutlined /> : <MinusCircleOutlined />}
      bordered
    >
      {shared ? t('artifacts.sharedLabel') : t('artifacts.notSharedLabel')}
    </Tag>
  );
}

/**
 * Artifacts page's contextual sidebar: every saved artifact, each with a kind
 * icon, a verified `StatusTag`, and a separate shared/published indicator.
 * Custom-built (like `ContextSidebar`) rather than the generic `SidebarList`,
 * which has no icon slot. Selecting a row drives the canvas (`ArtifactsPage`)
 * via `useArtifactsStore.select`.
 */
export function ArtifactsSidebar() {
  const summaries = useArtifactsStore((s) => s.summaries);
  const selectedKey = useArtifactsStore((s) => s.selectedKey);
  const select = useArtifactsStore((s) => s.select);

  return (
    <nav aria-label={t('artifacts.listHeader')} style={{ minWidth: 0 }}>
      <ul className="genbi-artifacts-list">
        {summaries.map((artifact) => {
          const selected = artifact.key === selectedKey;
          return (
            <li key={artifact.key}>
              <button
                type="button"
                className={`genbi-arow${selected ? ' is-sel' : ''}`}
                aria-current={selected ? 'true' : undefined}
                onClick={() => select(artifact.key)}
              >
                <span className="genbi-aicon" aria-label={KIND_LABEL[artifact.kind]}>
                  {KIND_ICON[artifact.kind]}
                </span>
                <span className="genbi-atext">
                  <span className="genbi-aname" title={artifact.name}>{artifact.name}</span>
                </span>
                <span className="genbi-abadges">
                  <StatusTag state={verifiedStateOf(artifact.verified)} />
                  <SharedTag shared={!!artifact.publish} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
