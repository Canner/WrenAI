import type { KnowledgeWorkbenchOverlaysProps } from './buildKnowledgeWorkbenchStageProps';
import type { KnowledgeWorkbenchControllerStageArgs } from './knowledgeWorkbenchControllerStageTypes';

export function buildKnowledgeWorkbenchControllerOverlaysInput({
  actions,
  contentData,
  knowledgeState,
  localState,
  viewState,
}: Pick<
  KnowledgeWorkbenchControllerStageArgs,
  'actions' | 'contentData' | 'knowledgeState' | 'localState' | 'viewState'
>): KnowledgeWorkbenchOverlaysProps {
  return {
    knowledgeBaseModalProps: {
      visible: actions.kbModalOpen,
      editingKnowledgeBase: actions.editingKnowledgeBase,
      form: localState.kbForm,
      canSaveKnowledgeBase: localState.canSaveKnowledgeBase,
      creatingKnowledgeBase: actions.creatingKnowledgeBase,
      onCancel: actions.closeKnowledgeBaseModal,
      onSave: actions.handleSaveKnowledgeBase,
    },
    assetWizardModalProps: {
      visible: localState.assetModalOpen,
      assetWizardStep: localState.assetWizardStep,
      onChangeAssetWizardStep: localState.setAssetWizardStep,
      activeKnowledgeBase: knowledgeState.activeKnowledgeBase ?? null,
      knowledgeBases: knowledgeState.knowledgeBases,
      sourceOptions: knowledgeState.knowledgeSourceOptions,
      selectedSourceType: contentData.selectedSourceType,
      setSelectedSourceType: contentData.setSelectedSourceType,
      openConnectorConsole: actions.openConnectorConsole,
      isDemoSource: contentData.isDemoSource,
      connectorsLoading: contentData.connectorsLoading,
      selectedDemoKnowledge: contentData.selectedDemoKnowledge ?? null,
      selectedConnectorId: contentData.selectedConnectorId,
      setSelectedConnectorId: contentData.setSelectedConnectorId,
      selectedDemoTable: contentData.selectedDemoTable,
      setSelectedDemoTable: contentData.setSelectedDemoTable,
      assetDatabaseOptions: viewState.assetDatabaseOptions,
      assetTableOptions: viewState.assetTableOptions,
      canContinueAssetWizard: contentData.canContinueAssetWizard,
      moveAssetWizardToConfig: viewState.moveAssetWizardToConfig,
      assetDraft: localState.assetDraft,
      setAssetDraft: localState.setAssetDraft,
      assetDraftPreview: viewState.assetDraftPreview,
      assetDraftPreviews: viewState.assetDraftPreviews,
      canContinueAssetConfiguration: viewState.canContinueAssetConfiguration,
      commitAssetDraftToOverview: viewState.commitAssetDraftToOverview,
      savingAssetDraft: viewState.savingAssetDraft,
      displayKnowledgeName: knowledgeState.displayKnowledgeName,
      closeAssetModal: actions.closeAssetModal,
      onNavigateModeling: viewState.handleNavigateModeling,
    },
  };
}

export default buildKnowledgeWorkbenchControllerOverlaysInput;
