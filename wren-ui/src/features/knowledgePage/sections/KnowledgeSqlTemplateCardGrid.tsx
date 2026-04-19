import { WorkbenchEditorCardGrid } from '@/features/knowledgePage/index.styles';
import type { SqlPair } from '@/types/knowledge';

import KnowledgeWorkbenchCreateEditorCard from './KnowledgeWorkbenchCreateEditorCard';
import KnowledgeSqlTemplateCard from './KnowledgeSqlTemplateCard';

type KnowledgeSqlTemplateCardGridProps = {
  editingSqlPair?: SqlPair | null;
  isKnowledgeMutationDisabled: boolean;
  sqlTemplateDrawerOpen: boolean;
  visibleSqlList: SqlPair[];
  onCreateSqlTemplate: () => void;
  onDeleteSqlTemplate: (sqlPair: SqlPair) => void | Promise<void>;
  onDuplicateSqlTemplate: (sqlPair: SqlPair) => void | Promise<void>;
  onSelectSqlTemplate: (sqlPair: SqlPair) => void;
};

export default function KnowledgeSqlTemplateCardGrid({
  editingSqlPair,
  isKnowledgeMutationDisabled,
  sqlTemplateDrawerOpen,
  visibleSqlList,
  onCreateSqlTemplate,
  onDeleteSqlTemplate,
  onDuplicateSqlTemplate,
  onSelectSqlTemplate,
}: KnowledgeSqlTemplateCardGridProps) {
  return (
    <WorkbenchEditorCardGrid>
      {!isKnowledgeMutationDisabled ? (
        <KnowledgeWorkbenchCreateEditorCard
          title="新建 SQL 模板"
          description="新增一条稳定口径模板，用于后续问答复用与团队沉淀。"
          onClick={onCreateSqlTemplate}
        />
      ) : null}
      {visibleSqlList.map((sqlPair) => (
        <KnowledgeSqlTemplateCard
          key={sqlPair.id}
          active={sqlTemplateDrawerOpen && editingSqlPair?.id === sqlPair.id}
          isKnowledgeMutationDisabled={isKnowledgeMutationDisabled}
          sqlPair={sqlPair}
          onDeleteSqlTemplate={onDeleteSqlTemplate}
          onDuplicateSqlTemplate={onDuplicateSqlTemplate}
          onSelectSqlTemplate={onSelectSqlTemplate}
        />
      ))}
    </WorkbenchEditorCardGrid>
  );
}
