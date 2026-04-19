import type { KnowledgeWorkbenchSidebarProps } from './buildKnowledgeWorkbenchStageProps';
import type { KnowledgeWorkbenchControllerStageArgs } from './knowledgeWorkbenchControllerStageTypes';

export function buildKnowledgeWorkbenchControllerSidebarInput({
  actions,
  knowledgeState,
  localState,
  viewState,
}: Pick<
  KnowledgeWorkbenchControllerStageArgs,
  'actions' | 'knowledgeState' | 'localState' | 'viewState'
>): KnowledgeWorkbenchSidebarProps {
  return {
    knowledgeTab: localState.knowledgeTab,
    onChangeKnowledgeTab: localState.setKnowledgeTab,
    visibleKnowledgeItems: viewState.visibleKnowledgeItems,
    visibleKnowledgeBaseId: viewState.visibleKnowledgeBaseId,
    activeKnowledgeBaseId: knowledgeState.activeKnowledgeBase?.id,
    activeAssetCount: viewState.detailAssets.length,
    switchKnowledgeBase: knowledgeState.switchKnowledgeBase,
    buildKnowledgeSwitchUrl: viewState.buildKnowledgeSwitchUrl,
    canCreateKnowledgeBase: knowledgeState.canCreateKnowledgeBase,
    createKnowledgeBaseBlockedReason:
      knowledgeState.createKnowledgeBaseBlockedReason,
    onCreateKnowledgeBase: actions.openCreateKnowledgeBaseModal,
  };
}

export default buildKnowledgeWorkbenchControllerSidebarInput;
