import { Typography } from 'antd';

import {
  WorkbenchEditorRail,
  WorkbenchSectionPanel,
} from '@/features/knowledgePage/index.styles';
import type { AssetView } from '@/features/knowledgePage/types';
import type { SqlPair } from '@/types/knowledge';

import KnowledgeSqlTemplateDrawer from './KnowledgeSqlTemplateDrawer';
import KnowledgeSqlTemplateList from './KnowledgeSqlTemplateList';

const { Text } = Typography;

type KnowledgeSqlTemplatesSectionProps = {
  sqlManageLoading: boolean;
  visibleSqlList: SqlPair[];
  sqlList: SqlPair[];
  sqlListMode: 'all' | 'recent';
  sqlSearchKeyword: string;
  sqlTemplateDrawerOpen: boolean;
  editingSqlPair?: SqlPair | null;
  isKnowledgeMutationDisabled: boolean;
  sqlTemplateAssetOptions: Array<{ label: string; value: string }>;
  sqlContextAssetId?: string;
  sqlContextAsset?: AssetView | null;
  sqlTemplateForm: any;
  createSqlPairLoading: boolean;
  updateSqlPairLoading: boolean;
  onSearchKeywordChange: (value: string) => void;
  onListModeChange: (mode: 'all' | 'recent') => void;
  onCreateSqlTemplate: () => void;
  onSelectSqlTemplate: (sqlPair: SqlPair) => void;
  onDuplicateSqlTemplate: (sqlPair: SqlPair) => void | Promise<void>;
  onDeleteSqlTemplate: (sqlPair: SqlPair) => void | Promise<void>;
  onCloseDrawer: () => void | Promise<void>;
  onSqlContextAssetChange: (value?: string) => void;
  onApplySqlContextDraft: () => void;
  onCreateRuleFromAsset: (asset: AssetView) => void | Promise<void>;
  onSubmitSqlTemplateDetail: () => void | Promise<void>;
  onResetSqlTemplateEditor: () => void;
};

export default function KnowledgeSqlTemplatesSection(
  props: KnowledgeSqlTemplatesSectionProps,
) {
  const {
    sqlManageLoading,
    visibleSqlList,
    sqlList,
    sqlListMode,
    sqlSearchKeyword,
    sqlTemplateDrawerOpen,
    editingSqlPair,
    isKnowledgeMutationDisabled,
    sqlTemplateAssetOptions,
    sqlContextAssetId,
    sqlContextAsset,
    sqlTemplateForm,
    createSqlPairLoading,
    updateSqlPairLoading,
    onSearchKeywordChange,
    onListModeChange,
    onCreateSqlTemplate,
    onSelectSqlTemplate,
    onDuplicateSqlTemplate,
    onDeleteSqlTemplate,
    onCloseDrawer,
    onSqlContextAssetChange,
    onApplySqlContextDraft,
    onCreateRuleFromAsset,
    onSubmitSqlTemplateDetail,
    onResetSqlTemplateEditor,
  } = props;

  return (
    <WorkbenchSectionPanel>
      {sqlManageLoading ? (
        <Text type="secondary">正在加载 SQL 模板…</Text>
      ) : (
        <>
          <WorkbenchEditorRail>
            <KnowledgeSqlTemplateList
              editingSqlPair={editingSqlPair}
              isKnowledgeMutationDisabled={isKnowledgeMutationDisabled}
              sqlList={sqlList}
              sqlListMode={sqlListMode}
              sqlSearchKeyword={sqlSearchKeyword}
              sqlTemplateDrawerOpen={sqlTemplateDrawerOpen}
              visibleSqlList={visibleSqlList}
              onCreateSqlTemplate={onCreateSqlTemplate}
              onDeleteSqlTemplate={onDeleteSqlTemplate}
              onDuplicateSqlTemplate={onDuplicateSqlTemplate}
              onListModeChange={onListModeChange}
              onSearchKeywordChange={onSearchKeywordChange}
              onSelectSqlTemplate={onSelectSqlTemplate}
            />
          </WorkbenchEditorRail>
          <KnowledgeSqlTemplateDrawer
            createSqlPairLoading={createSqlPairLoading}
            isKnowledgeMutationDisabled={isKnowledgeMutationDisabled}
            open={sqlTemplateDrawerOpen}
            sqlContextAsset={sqlContextAsset}
            sqlContextAssetId={sqlContextAssetId}
            sqlTemplateAssetOptions={sqlTemplateAssetOptions}
            sqlTemplateForm={sqlTemplateForm}
            updateSqlPairLoading={updateSqlPairLoading}
            onApplySqlContextDraft={onApplySqlContextDraft}
            onCloseDrawer={onCloseDrawer}
            onCreateRuleFromAsset={onCreateRuleFromAsset}
            onResetSqlTemplateEditor={onResetSqlTemplateEditor}
            onSqlContextAssetChange={onSqlContextAssetChange}
            onSubmitSqlTemplateDetail={onSubmitSqlTemplateDetail}
          />
        </>
      )}
    </WorkbenchSectionPanel>
  );
}
