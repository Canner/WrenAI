import type { AssetView } from '@/features/knowledgePage/types';

import KnowledgeSqlTemplateFormFields from './KnowledgeSqlTemplateFormFields';
import KnowledgeWorkbenchAssetEditorDrawer from './KnowledgeWorkbenchAssetEditorDrawer';

type KnowledgeSqlTemplateDrawerProps = {
  createSqlPairLoading: boolean;
  isKnowledgeMutationDisabled: boolean;
  open: boolean;
  sqlContextAsset?: AssetView | null;
  sqlContextAssetId?: string;
  sqlTemplateAssetOptions: Array<{ label: string; value: string }>;
  sqlTemplateForm: any;
  updateSqlPairLoading: boolean;
  onApplySqlContextDraft: () => void;
  onCloseDrawer: () => void | Promise<void>;
  onCreateRuleFromAsset: (asset: AssetView) => void | Promise<void>;
  onResetSqlTemplateEditor: () => void;
  onSqlContextAssetChange: (value?: string) => void;
  onSubmitSqlTemplateDetail: () => void | Promise<void>;
};

export default function KnowledgeSqlTemplateDrawer({
  createSqlPairLoading,
  isKnowledgeMutationDisabled,
  open,
  sqlContextAsset,
  sqlContextAssetId,
  sqlTemplateAssetOptions,
  sqlTemplateForm,
  updateSqlPairLoading,
  onApplySqlContextDraft,
  onCloseDrawer,
  onCreateRuleFromAsset,
  onResetSqlTemplateEditor,
  onSqlContextAssetChange,
  onSubmitSqlTemplateDetail,
}: KnowledgeSqlTemplateDrawerProps) {
  return (
    <KnowledgeWorkbenchAssetEditorDrawer
      actions={[
        { label: '带入示例 SQL', onClick: () => onApplySqlContextDraft() },
        { label: '去沉淀分析规则', onClick: onCreateRuleFromAsset },
      ]}
      asset={sqlContextAsset}
      assetMeta={`${
        sqlContextAsset?.sourceTableName || '未暴露源表名'
      } · ${sqlContextAsset?.fieldCount || 0} 个字段`}
      assetOptions={sqlTemplateAssetOptions}
      form={sqlTemplateForm}
      isReadonly={isKnowledgeMutationDisabled}
      loading={createSqlPairLoading || updateSqlPairLoading}
      open={open}
      placeholder="选择一个资产，把典型问法和 SQL 草稿带进来"
      questionField="description"
      saveLabel="保存 SQL 模板"
      selectedAssetId={sqlContextAssetId}
      onAssetChange={onSqlContextAssetChange}
      onClose={onCloseDrawer}
      onReset={onResetSqlTemplateEditor}
      onSubmit={onSubmitSqlTemplateDetail}
    >
      <KnowledgeSqlTemplateFormFields
        isReadonly={isKnowledgeMutationDisabled}
        sqlTemplateForm={sqlTemplateForm}
      />
    </KnowledgeWorkbenchAssetEditorDrawer>
  );
}
