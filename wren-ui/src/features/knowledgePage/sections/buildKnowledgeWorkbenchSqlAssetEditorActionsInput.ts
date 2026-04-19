import {
  EMPTY_SQL_TEMPLATE_VALUES,
  buildSqlTemplateDraftFromAsset,
} from '@/utils/knowledgeWorkbenchEditor';
import type { SqlPair } from '@/types/knowledge';
import { buildSqlTemplateEditorValues } from './knowledgeWorkbenchEditorValueBuilders';
import resolveKnowledgeWorkbenchDraftDirty from './resolveKnowledgeWorkbenchDraftDirty';
import type {
  KnowledgeWorkbenchSqlActionsArgs,
  KnowledgeWorkbenchSqlOpenEditorParams,
  SqlDraftValues,
} from './knowledgeWorkbenchSqlAssetEditorActionTypes';

export function buildKnowledgeWorkbenchSqlAssetEditorActionsInput({
  activeWorkbenchSection,
  editingSqlPair,
  isRuleDraftDirty,
  isSqlDraftDirty,
  onChangeWorkbenchSection,
  onCreateSqlTemplateDraftFromAsset,
  onDeleteSqlTemplate,
  onOpenSqlTemplateDetail,
  onResetSqlTemplateEditor,
  onSubmitSqlTemplateDetail,
  sqlTemplateForm,
  sqlTemplateDrawerOpen,
  syncSqlDraftBaseline,
  setSqlContextAssetId,
  setSqlTemplateDrawerOpen,
  sqlContextAsset,
  runWithDirtyGuard,
  confirmDeleteEntry,
}: KnowledgeWorkbenchSqlActionsArgs) {
  return {
    activeWorkbenchSection,
    applySuccessMessage: '已将参考资产内容带入当前 SQL 模板。',
    buildDraftFromAsset: buildSqlTemplateDraftFromAsset,
    buildDuplicateDraft: (sqlPair: SqlPair) => ({
      description: `${sqlPair.question || 'SQL 模板'}（副本）`,
      sql: sqlPair.sql,
    }),
    buildEditorValues: ({
      item,
      draftValues,
    }: {
      item?: SqlPair;
      draftValues?: SqlDraftValues;
    }) =>
      buildSqlTemplateEditorValues({
        sqlPair: item,
        draftValues,
      }),
    confirmDeleteEntry,
    contextAsset: sqlContextAsset,
    createFromAssetSuccessMessage: '已带入资产上下文，可继续完善 SQL 模板。',
    currentEditingId: editingSqlPair?.id || null,
    currentSectionDirty: isSqlDraftDirty,
    counterpartSectionDirty: resolveKnowledgeWorkbenchDraftDirty({
      isRuleDraftDirty,
      isSqlDraftDirty,
      section: 'instructions',
    }),
    drawerOpen: sqlTemplateDrawerOpen,
    duplicateSuccessMessage: '已生成 SQL 模板草稿副本。',
    editingItemId: editingSqlPair?.id,
    emptyValues: EMPTY_SQL_TEMPLATE_VALUES,
    entityLabel: 'SQL 模板',
    form: sqlTemplateForm,
    getItemId: (sqlPair: SqlPair) => sqlPair.id,
    onChangeWorkbenchSection,
    onCreateDraftFromAsset: onCreateSqlTemplateDraftFromAsset,
    onDeleteItem: onDeleteSqlTemplate,
    onOpenDetail: onOpenSqlTemplateDetail,
    onResetEditor: onResetSqlTemplateEditor,
    onSubmitDetail: onSubmitSqlTemplateDetail,
    runWithDirtyGuard,
    setContextAssetId: setSqlContextAssetId,
    setDrawerOpen: setSqlTemplateDrawerOpen,
    syncDraftBaseline: syncSqlDraftBaseline,
    targetSection: 'sqlTemplates' as const,
  };
}

export function buildKnowledgeWorkbenchSqlOpenEditorInput(
  params: KnowledgeWorkbenchSqlOpenEditorParams,
) {
  return {
    item: params.sqlPair,
    draftValues: params.draftValues,
    contextAssetId: params.contextAssetId,
    switchSection: params.switchSection,
  };
}
