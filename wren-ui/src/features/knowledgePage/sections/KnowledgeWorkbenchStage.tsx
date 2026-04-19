import type { ComponentProps } from 'react';
import {
  LibraryStage,
  WorkbenchGrid,
} from '@/features/knowledgePage/index.styles';
import KnowledgeWorkbenchOverlays from '@/features/knowledgePage/modals/KnowledgeWorkbenchOverlays';
import KnowledgeLoadingStage from './KnowledgeLoadingStage';
import KnowledgeMainStage from './KnowledgeMainStage';
import KnowledgeSidebarRail from './KnowledgeSidebarRail';

type KnowledgeSidebarRailProps = ComponentProps<typeof KnowledgeSidebarRail>;
type KnowledgeMainStageProps = ComponentProps<typeof KnowledgeMainStage>;
type KnowledgeWorkbenchOverlaysProps = ComponentProps<
  typeof KnowledgeWorkbenchOverlays
>;

export function KnowledgeWorkbenchStage({
  loading,
  sidebarProps,
  mainStageProps,
  overlaysProps,
}: {
  loading: boolean;
  sidebarProps: KnowledgeSidebarRailProps;
  mainStageProps: KnowledgeMainStageProps;
  overlaysProps: KnowledgeWorkbenchOverlaysProps;
}) {
  if (loading) {
    return <KnowledgeLoadingStage />;
  }

  return (
    <LibraryStage>
      <WorkbenchGrid>
        <KnowledgeSidebarRail {...sidebarProps} />
        <KnowledgeMainStage {...mainStageProps} />
      </WorkbenchGrid>

      <KnowledgeWorkbenchOverlays {...overlaysProps} />
    </LibraryStage>
  );
}

export default KnowledgeWorkbenchStage;
