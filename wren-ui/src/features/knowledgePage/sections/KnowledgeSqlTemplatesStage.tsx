import type { AssetView } from '@/features/knowledgePage/types';
import type { SqlPair } from '@/types/knowledge';

import KnowledgeSqlTemplatesSection from './KnowledgeSqlTemplatesSection';

export type KnowledgeSqlTemplatesStageProps = {
  createSqlPairLoading: boolean;
  editingSqlPair?: SqlPair | null;
  handleCloseSqlTemplateDrawer: () => void | Promise<void | boolean>;
  handleCreateRuleFromAsset: (asset: AssetView) => void | Promise<void>;
  handleDeleteSqlTemplate: (sqlPair: SqlPair) => void | Promise<void | boolean>;
  handleDuplicateSqlTemplate: (
    sqlPair: SqlPair,
  ) => void | Promise<void | boolean>;
  handleResetSqlTemplateEditor: () => void;
  handleSubmitSqlTemplateDetail: () => Promise<void | boolean> | void;
  isKnowledgeMutationDisabled: boolean;
  openSqlTemplateEditor: (input: {
    sqlPair?: SqlPair;
    switchSection?: boolean;
  }) => void | Promise<void | boolean>;
  setSqlContextAssetId: (value?: string) => void;
  setSqlListMode: (mode: 'all' | 'recent') => void;
  setSqlSearchKeyword: (value: string) => void;
  sqlContextAsset?: AssetView | null;
  sqlContextAssetId?: string;
  sqlList: SqlPair[];
  sqlListMode: 'all' | 'recent';
  sqlManageLoading: boolean;
  sqlSearchKeyword: string;
  sqlTemplateAssetOptions: Array<{ label: string; value: string }>;
  sqlTemplateDrawerOpen: boolean;
  sqlTemplateForm: any;
  updateSqlPairLoading: boolean;
  visibleSqlList: SqlPair[];
  applySqlContextDraft: () => void;
};

export default function KnowledgeSqlTemplatesStage({
  applySqlContextDraft,
  createSqlPairLoading,
  editingSqlPair,
  handleCloseSqlTemplateDrawer,
  handleCreateRuleFromAsset,
  handleDeleteSqlTemplate,
  handleDuplicateSqlTemplate,
  handleResetSqlTemplateEditor,
  handleSubmitSqlTemplateDetail,
  isKnowledgeMutationDisabled,
  openSqlTemplateEditor,
  setSqlContextAssetId,
  setSqlListMode,
  setSqlSearchKeyword,
  sqlContextAsset,
  sqlContextAssetId,
  sqlList,
  sqlListMode,
  sqlManageLoading,
  sqlSearchKeyword,
  sqlTemplateAssetOptions,
  sqlTemplateDrawerOpen,
  sqlTemplateForm,
  updateSqlPairLoading,
  visibleSqlList,
}: KnowledgeSqlTemplatesStageProps) {
  return (
    <KnowledgeSqlTemplatesSection
      createSqlPairLoading={createSqlPairLoading}
      editingSqlPair={editingSqlPair}
      isKnowledgeMutationDisabled={isKnowledgeMutationDisabled}
      sqlContextAsset={sqlContextAsset}
      sqlContextAssetId={sqlContextAssetId}
      sqlList={sqlList}
      sqlListMode={sqlListMode}
      sqlManageLoading={sqlManageLoading}
      sqlSearchKeyword={sqlSearchKeyword}
      sqlTemplateAssetOptions={sqlTemplateAssetOptions}
      sqlTemplateDrawerOpen={sqlTemplateDrawerOpen}
      sqlTemplateForm={sqlTemplateForm}
      updateSqlPairLoading={updateSqlPairLoading}
      visibleSqlList={visibleSqlList}
      onApplySqlContextDraft={applySqlContextDraft}
      onCloseDrawer={() => void handleCloseSqlTemplateDrawer()}
      onCreateRuleFromAsset={handleCreateRuleFromAsset}
      onCreateSqlTemplate={() => void openSqlTemplateEditor({})}
      onDeleteSqlTemplate={(sqlPair) => void handleDeleteSqlTemplate(sqlPair)}
      onDuplicateSqlTemplate={(sqlPair) =>
        void handleDuplicateSqlTemplate(sqlPair)
      }
      onListModeChange={setSqlListMode}
      onResetSqlTemplateEditor={handleResetSqlTemplateEditor}
      onSearchKeywordChange={setSqlSearchKeyword}
      onSelectSqlTemplate={(sqlPair) =>
        void openSqlTemplateEditor({ sqlPair, switchSection: false })
      }
      onSqlContextAssetChange={setSqlContextAssetId}
      onSubmitSqlTemplateDetail={() => void handleSubmitSqlTemplateDetail()}
    />
  );
}
