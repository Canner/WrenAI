import type { SqlPair } from '@/types/knowledge';
import { formatKnowledgeWorkbenchTimestamp } from '@/utils/knowledgeWorkbenchEditor';

import KnowledgeWorkbenchEditorItemCard from './KnowledgeWorkbenchEditorItemCard';

const resolveSqlTemplateCardStatus = (sqlPair: SqlPair) =>
  sqlPair.updatedAt ? '已保存' : '新建后未同步';

type KnowledgeSqlTemplateCardProps = {
  active: boolean;
  isKnowledgeMutationDisabled: boolean;
  sqlPair: SqlPair;
  onDeleteSqlTemplate: (sqlPair: SqlPair) => void | Promise<void>;
  onDuplicateSqlTemplate: (sqlPair: SqlPair) => void | Promise<void>;
  onSelectSqlTemplate: (sqlPair: SqlPair) => void;
};

export default function KnowledgeSqlTemplateCard({
  active,
  isKnowledgeMutationDisabled,
  sqlPair,
  onDeleteSqlTemplate,
  onDuplicateSqlTemplate,
  onSelectSqlTemplate,
}: KnowledgeSqlTemplateCardProps) {
  return (
    <KnowledgeWorkbenchEditorItemCard
      active={active}
      deleteTitle="删除 SQL 模板"
      description={sqlPair.sql || '暂无 SQL 内容'}
      duplicateTitle="复制为新草稿"
      isReadonly={isKnowledgeMutationDisabled}
      metaText={`更新于 ${formatKnowledgeWorkbenchTimestamp(
        sqlPair.updatedAt || sqlPair.createdAt,
      )}`}
      statusLabel={resolveSqlTemplateCardStatus(sqlPair)}
      statusTone="accent"
      title={sqlPair.question || '未命名 SQL 模板'}
      onDelete={() => onDeleteSqlTemplate(sqlPair)}
      onDuplicate={() => onDuplicateSqlTemplate(sqlPair)}
      onSelect={() => onSelectSqlTemplate(sqlPair)}
    />
  );
}
