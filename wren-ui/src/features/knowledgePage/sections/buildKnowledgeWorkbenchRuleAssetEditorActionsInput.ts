import {
  EMPTY_RULE_EDITOR_VALUES,
  buildRuleDraftFromAsset,
} from '@/utils/knowledgeWorkbenchEditor';
import { parseInstructionDraft } from '@/hooks/useKnowledgeRuleSqlManager';
import type { Instruction } from '@/types/knowledge';
import { buildRuleEditorValues } from './knowledgeWorkbenchEditorValueBuilders';
import resolveKnowledgeWorkbenchDraftDirty from './resolveKnowledgeWorkbenchDraftDirty';
import type {
  KnowledgeWorkbenchRuleActionsArgs,
  KnowledgeWorkbenchRuleOpenEditorParams,
  RuleDraftValues,
} from './knowledgeWorkbenchRuleAssetEditorActionTypes';

export function buildKnowledgeWorkbenchRuleAssetEditorActionsInput({
  activeWorkbenchSection,
  editingInstruction,
  isRuleDraftDirty,
  isSqlDraftDirty,
  onChangeWorkbenchSection,
  onCreateRuleDraftFromAsset,
  onDeleteRule,
  onOpenRuleDetail,
  onResetRuleDetailEditor,
  onSubmitRuleDetail,
  ruleDrawerOpen,
  ruleForm,
  syncRuleDraftBaseline,
  setRuleContextAssetId,
  setRuleDrawerOpen,
  ruleContextAsset,
  runWithDirtyGuard,
  confirmDeleteEntry,
}: KnowledgeWorkbenchRuleActionsArgs) {
  return {
    activeWorkbenchSection,
    applySuccessMessage: '已将参考资产内容带入当前分析规则。',
    buildDraftFromAsset: buildRuleDraftFromAsset,
    buildDuplicateDraft: (instruction: Instruction) => {
      const draft = parseInstructionDraft(instruction);
      return {
        summary: `${draft.summary || '分析规则'}（副本）`,
        scope: draft.scope,
        content: draft.content,
      };
    },
    buildEditorValues: ({
      item,
      draftValues,
    }: {
      item?: Instruction;
      draftValues?: RuleDraftValues;
    }) =>
      buildRuleEditorValues({
        instruction: item,
        draftValues,
      }),
    confirmDeleteEntry,
    contextAsset: ruleContextAsset,
    createFromAssetSuccessMessage: '已带入资产上下文，可继续完善分析规则。',
    currentEditingId: editingInstruction?.id || null,
    currentSectionDirty: isRuleDraftDirty,
    counterpartSectionDirty: resolveKnowledgeWorkbenchDraftDirty({
      isRuleDraftDirty,
      isSqlDraftDirty,
      section: 'sqlTemplates',
    }),
    drawerOpen: ruleDrawerOpen,
    duplicateSuccessMessage: '已生成分析规则草稿副本。',
    editingItemId: editingInstruction?.id,
    emptyValues: EMPTY_RULE_EDITOR_VALUES,
    entityLabel: '分析规则',
    form: ruleForm,
    getItemId: (instruction: Instruction) => instruction.id,
    onChangeWorkbenchSection,
    onCreateDraftFromAsset: onCreateRuleDraftFromAsset,
    onDeleteItem: onDeleteRule,
    onOpenDetail: onOpenRuleDetail,
    onResetEditor: onResetRuleDetailEditor,
    onSubmitDetail: onSubmitRuleDetail,
    runWithDirtyGuard,
    setContextAssetId: setRuleContextAssetId,
    setDrawerOpen: setRuleDrawerOpen,
    syncDraftBaseline: syncRuleDraftBaseline,
    targetSection: 'instructions' as const,
  };
}

export function buildKnowledgeWorkbenchRuleOpenEditorInput(
  params: KnowledgeWorkbenchRuleOpenEditorParams,
) {
  return {
    item: params.instruction,
    draftValues: params.draftValues,
    contextAssetId: params.contextAssetId,
    switchSection: params.switchSection,
  };
}
