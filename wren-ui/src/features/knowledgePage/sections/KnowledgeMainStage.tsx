import {
  buildKnowledgeInstructionsStageProps,
  buildKnowledgeModelingSectionProps,
  buildKnowledgeMainStageEditorsInput,
  buildKnowledgeOverviewStageProps,
  buildKnowledgeSqlTemplatesStageProps,
  buildKnowledgeWorkbenchHeaderProps,
} from '@/features/knowledgePage/sections/buildKnowledgeMainStageSectionProps';
import { MainStage } from '@/features/knowledgePage/index.styles';
import KnowledgeWorkbenchHeader, {
  resolveKnowledgeWorkbenchModeLabel,
} from '@/features/knowledgePage/sections/KnowledgeWorkbenchHeader';
import KnowledgeInstructionsStage from '@/features/knowledgePage/sections/KnowledgeInstructionsStage';
import KnowledgeModelingSection from '@/features/knowledgePage/sections/KnowledgeModelingSection';
import KnowledgeOverviewStage from '@/features/knowledgePage/sections/KnowledgeOverviewStage';
import KnowledgeSqlTemplatesStage from '@/features/knowledgePage/sections/KnowledgeSqlTemplatesStage';
import type { KnowledgeMainStageProps } from '@/features/knowledgePage/sections/knowledgeMainStageTypes';
import { useKnowledgeWorkbenchEditors } from '@/features/knowledgePage/sections/useKnowledgeWorkbenchEditors';

function KnowledgeMainStage({
  activeWorkbenchSection,
  onChangeWorkbenchSection,
  previewFieldCount,
  isSnapshotReadonlyKnowledgeBase,
  isReadonlyKnowledgeBase,
  isKnowledgeMutationDisabled,
  knowledgeMutationHint,
  knowledgeDescription,
  showKnowledgeAssetsLoading,
  detailAssets,
  activeDetailAsset,
  detailTab,
  detailFieldKeyword,
  detailFieldFilter,
  detailAssetFields,
  onOpenAssetWizard,
  onOpenKnowledgeEditor,
  onOpenAssetDetail,
  onCloseAssetDetail,
  onCreateRuleDraftFromAsset,
  onCreateSqlTemplateDraftFromAsset,
  onChangeDetailTab,
  onChangeFieldKeyword,
  onChangeFieldFilter,
  historicalSnapshotReadonlyHint,
  ruleList,
  sqlList,
  ruleManageLoading,
  sqlManageLoading,
  onOpenRuleDetail,
  onOpenSqlTemplateDetail,
  onDeleteRule: _onDeleteRule,
  onDeleteSqlTemplate: _onDeleteSqlTemplate,
  editingInstruction,
  editingSqlPair,
  ruleForm,
  sqlTemplateForm,
  createInstructionLoading,
  updateInstructionLoading,
  createSqlPairLoading,
  updateSqlPairLoading,
  onSubmitRuleDetail,
  onSubmitSqlTemplateDetail,
  onResetRuleDetailEditor,
  onResetSqlTemplateEditor,
  modelingWorkspaceKey,
  modelingSummary,
  onOpenModeling,
}: KnowledgeMainStageProps) {
  const workbenchModeLabel = resolveKnowledgeWorkbenchModeLabel({
    isReadonlyKnowledgeBase,
    isSnapshotReadonlyKnowledgeBase,
  });
  const editors = useKnowledgeWorkbenchEditors(
    buildKnowledgeMainStageEditorsInput({
      activeWorkbenchSection,
      detailAssets,
      editingInstruction,
      editingSqlPair,
      onChangeWorkbenchSection,
      onCreateRuleDraftFromAsset,
      onCreateSqlTemplateDraftFromAsset,
      onDeleteRule: _onDeleteRule,
      onDeleteSqlTemplate: _onDeleteSqlTemplate,
      onOpenRuleDetail,
      onOpenSqlTemplateDetail,
      onResetRuleDetailEditor,
      onResetSqlTemplateEditor,
      onSubmitRuleDetail,
      onSubmitSqlTemplateDetail,
      ruleForm,
      ruleList,
      sqlList,
      sqlTemplateForm,
    }),
  );
  const {
    handleCreateRuleFromAsset,
    handleCreateSqlTemplateFromAsset,
    handleWorkbenchSectionChange,
  } = editors;
  return (
    <MainStage>
      <KnowledgeWorkbenchHeader
        {...buildKnowledgeWorkbenchHeaderProps({
          activeWorkbenchSection,
          previewFieldCount,
          isSnapshotReadonlyKnowledgeBase,
          isReadonlyKnowledgeBase,
          isKnowledgeMutationDisabled,
          knowledgeMutationHint,
          knowledgeDescription,
          onOpenKnowledgeEditor,
          onChangeWorkbenchSection: handleWorkbenchSectionChange,
        })}
      />

      <KnowledgeOverviewStage
        {...buildKnowledgeOverviewStageProps({
          activeWorkbenchSection,
          activeDetailAsset,
          detailAssetFields,
          detailAssets,
          detailFieldFilter,
          detailFieldKeyword,
          detailTab,
          historicalSnapshotReadonlyHint,
          isKnowledgeMutationDisabled,
          isReadonlyKnowledgeBase,
          isSnapshotReadonlyKnowledgeBase,
          modelingSummary,
          onChangeDetailTab,
          onChangeFieldFilter,
          onChangeFieldKeyword,
          onCloseAssetDetail,
          onCreateRuleDraft: handleCreateRuleFromAsset,
          onCreateSqlTemplateDraft: handleCreateSqlTemplateFromAsset,
          onOpenAssetDetail,
          onOpenAssetWizard,
          onOpenModeling,
          previewFieldCount,
          ruleList,
          showKnowledgeAssetsLoading,
          sqlList,
        })}
      />

      {activeWorkbenchSection === 'modeling' ? (
        <KnowledgeModelingSection
          {...buildKnowledgeModelingSectionProps({
            modelingSummary,
            modelingWorkspaceKey,
            workbenchModeLabel,
          })}
        />
      ) : null}

      {activeWorkbenchSection === 'sqlTemplates' ? (
        <KnowledgeSqlTemplatesStage
          {...buildKnowledgeSqlTemplatesStageProps({
            createSqlPairLoading,
            editingSqlPair,
            editors,
            isKnowledgeMutationDisabled,
            sqlList,
            sqlManageLoading,
            sqlTemplateForm,
            updateSqlPairLoading,
          })}
        />
      ) : null}

      {activeWorkbenchSection === 'instructions' ? (
        <KnowledgeInstructionsStage
          {...buildKnowledgeInstructionsStageProps({
            createInstructionLoading,
            editingInstruction,
            editors,
            isKnowledgeMutationDisabled,
            ruleForm,
            ruleList,
            ruleManageLoading,
            updateInstructionLoading,
          })}
        />
      ) : null}
    </MainStage>
  );
}

export default KnowledgeMainStage;
