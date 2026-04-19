import type { ComponentProps } from 'react';
import KnowledgeWorkbenchStage from './sections/KnowledgeWorkbenchStage';
import KnowledgeMainStage from './sections/KnowledgeMainStage';
import KnowledgeSidebarRail from './sections/KnowledgeSidebarRail';

export type KnowledgeWorkbenchSidebarProps = ComponentProps<
  typeof KnowledgeSidebarRail
>;
export type KnowledgeWorkbenchMainStageProps = ComponentProps<
  typeof KnowledgeMainStage
>;
export type KnowledgeWorkbenchOverlaysProps = ComponentProps<
  typeof KnowledgeWorkbenchStage
>['overlaysProps'];
