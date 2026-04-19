import { HISTORICAL_SNAPSHOT_READONLY_HINT } from '@/utils/runtimeSnapshot';
import {
  type KnowledgeWorkbenchMainStageProps,
  type KnowledgeWorkbenchOverlaysProps,
  type KnowledgeWorkbenchSidebarProps,
} from './buildKnowledgeWorkbenchStageProps';

export function buildKnowledgeWorkbenchPageStage({
  sidebar,
  mainStage,
  overlays,
}: {
  sidebar: KnowledgeWorkbenchSidebarProps;
  mainStage: Omit<
    KnowledgeWorkbenchMainStageProps,
    'historicalSnapshotReadonlyHint'
  >;
  overlays: KnowledgeWorkbenchOverlaysProps;
}) {
  return {
    sidebarProps: sidebar,
    mainStageProps: {
      historicalSnapshotReadonlyHint: HISTORICAL_SNAPSHOT_READONLY_HINT,
      ...mainStage,
    },
    overlaysProps: overlays,
  };
}

export default buildKnowledgeWorkbenchPageStage;
