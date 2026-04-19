import type { SqlPair } from '@/types/knowledge';

import KnowledgeWorkbenchEditorEmptyState from './KnowledgeWorkbenchEditorEmptyState';
import KnowledgeWorkbenchEditorRailControls from './KnowledgeWorkbenchEditorRailControls';
import KnowledgeSqlTemplateCardGrid from './KnowledgeSqlTemplateCardGrid';

const SQL_TEMPLATE_FILTER_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: 'recent', label: '最近更新' },
] as const;

type KnowledgeSqlTemplateListProps = {
  editingSqlPair?: SqlPair | null;
  isKnowledgeMutationDisabled: boolean;
  sqlList: SqlPair[];
  sqlListMode: 'all' | 'recent';
  sqlSearchKeyword: string;
  sqlTemplateDrawerOpen: boolean;
  visibleSqlList: SqlPair[];
  onCreateSqlTemplate: () => void;
  onDeleteSqlTemplate: (sqlPair: SqlPair) => void | Promise<void>;
  onDuplicateSqlTemplate: (sqlPair: SqlPair) => void | Promise<void>;
  onListModeChange: (mode: 'all' | 'recent') => void;
  onSearchKeywordChange: (value: string) => void;
  onSelectSqlTemplate: (sqlPair: SqlPair) => void;
};

export default function KnowledgeSqlTemplateList({
  editingSqlPair,
  isKnowledgeMutationDisabled,
  sqlList,
  sqlListMode,
  sqlSearchKeyword,
  sqlTemplateDrawerOpen,
  visibleSqlList,
  onCreateSqlTemplate,
  onDeleteSqlTemplate,
  onDuplicateSqlTemplate,
  onListModeChange,
  onSearchKeywordChange,
  onSelectSqlTemplate,
}: KnowledgeSqlTemplateListProps) {
  const hasVisibleContent =
    visibleSqlList.length > 0 || !isKnowledgeMutationDisabled;

  return (
    <>
      <KnowledgeWorkbenchEditorRailControls
        activeFilter={sqlListMode}
        filterOptions={[...SQL_TEMPLATE_FILTER_OPTIONS]}
        searchPlaceholder="搜索模板名称、问法或 SQL 片段"
        searchValue={sqlSearchKeyword}
        visibleCount={visibleSqlList.length}
        totalCount={sqlList.length}
        onFilterChange={(mode) => onListModeChange(mode as 'all' | 'recent')}
        onSearchChange={onSearchKeywordChange}
      />
      {hasVisibleContent ? (
        <KnowledgeSqlTemplateCardGrid
          editingSqlPair={editingSqlPair}
          isKnowledgeMutationDisabled={isKnowledgeMutationDisabled}
          sqlTemplateDrawerOpen={sqlTemplateDrawerOpen}
          visibleSqlList={visibleSqlList}
          onCreateSqlTemplate={onCreateSqlTemplate}
          onDeleteSqlTemplate={onDeleteSqlTemplate}
          onDuplicateSqlTemplate={onDuplicateSqlTemplate}
          onSelectSqlTemplate={onSelectSqlTemplate}
        />
      ) : (
        <KnowledgeWorkbenchEditorEmptyState
          title={
            sqlList.length > 0 ? '没有匹配的 SQL 模板' : '先创建第一条 SQL 模板'
          }
          description={
            sqlList.length > 0
              ? '试试更换关键字，或切换到“全部 / 最近更新”查看其它模板。'
              : '先新增一条模板，再在右侧抽屉里填写典型问法与 SQL 内容。'
          }
        />
      )}
    </>
  );
}
