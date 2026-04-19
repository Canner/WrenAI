import buildKnowledgeWorkbenchPageStage from './buildKnowledgeWorkbenchPageStage';
import { buildKnowledgeWorkbenchControllerMainStageInput } from './buildKnowledgeWorkbenchControllerMainStageInput';
import { buildKnowledgeWorkbenchControllerOverlaysInput } from './buildKnowledgeWorkbenchControllerOverlaysInput';
import { buildKnowledgeWorkbenchControllerSidebarInput } from './buildKnowledgeWorkbenchControllerSidebarInput';
import type { KnowledgeWorkbenchControllerStageArgs } from './knowledgeWorkbenchControllerStageTypes';

export function buildKnowledgeWorkbenchControllerStage(
  args: KnowledgeWorkbenchControllerStageArgs,
) {
  return buildKnowledgeWorkbenchPageStage({
    sidebar: buildKnowledgeWorkbenchControllerSidebarInput(args),
    mainStage: buildKnowledgeWorkbenchControllerMainStageInput(args),
    overlays: buildKnowledgeWorkbenchControllerOverlaysInput(args),
  });
}

export default buildKnowledgeWorkbenchControllerStage;
