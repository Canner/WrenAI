import type { AssetFieldView, AssetView } from '@/features/knowledgePage/types';
import {
  parseInstructionDraft,
  type RuleDetailFormValues,
  type SqlTemplateFormValues,
} from '@/hooks/useKnowledgeRuleSqlManager';
import type { Instruction, SqlPair } from '@/types/knowledge';

const RECENT_LIST_LIMIT = 6;

export const EMPTY_SQL_TEMPLATE_VALUES: SqlTemplateFormValues = {
  sql: '',
  scope: 'all',
  description: '',
};

export const EMPTY_RULE_EDITOR_VALUES: RuleDetailFormValues = {
  summary: '',
  scope: 'all',
  content: '',
};

const collapseWhitespace = (value?: string | null) =>
  (value || '').replace(/\s+/g, ' ').trim();

const resolveUpdatedTimestamp = (value?: string | null) => {
  if (!value) {
    return 0;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const sortByUpdatedAtDesc = <
  T extends { updatedAt?: string | null; createdAt?: string | null },
>(
  items: T[],
) =>
  [...items].sort(
    (left, right) =>
      resolveUpdatedTimestamp(right.updatedAt || right.createdAt) -
      resolveUpdatedTimestamp(left.updatedAt || left.createdAt),
  );

const resolveAssetSuggestedQuestion = (
  asset: Pick<AssetView, 'name' | 'suggestedQuestions'>,
) =>
  asset.suggestedQuestions?.find((question) => collapseWhitespace(question)) ||
  `${asset.name} 的典型业务问题`;

const resolveAssetSourceName = (
  asset: Pick<AssetView, 'name' | 'sourceTableName'>,
) => asset.sourceTableName || asset.name;

export const formatKnowledgeWorkbenchTimestamp = (value?: string | null) => {
  if (!value) {
    return '未记录';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '未记录';
  }

  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${month}-${day} ${hours}:${minutes}`;
};

export const buildSqlTemplateDraftFromAsset = (
  asset: Pick<
    AssetView,
    'name' | 'sourceTableName' | 'sourceSql' | 'suggestedQuestions'
  >,
): SqlTemplateFormValues => {
  const sourceName = resolveAssetSourceName(asset);
  const question = resolveAssetSuggestedQuestion(asset);
  const trimmedSourceSql = asset.sourceSql?.trim();

  return {
    scope: 'all',
    description: question,
    sql:
      trimmedSourceSql ||
      [
        `-- 参考资产：${asset.name}`,
        'SELECT',
        '  *',
        `FROM ${sourceName}`,
        'LIMIT 100;',
      ].join('\n'),
  };
};

export const buildRuleDraftFromAsset = (
  asset: Pick<
    AssetView,
    | 'name'
    | 'description'
    | 'primaryKey'
    | 'sourceTableName'
    | 'relationCount'
    | 'fieldCount'
    | 'suggestedQuestions'
  >,
): RuleDetailFormValues => {
  const suggestedQuestions = (asset.suggestedQuestions || [])
    .map((question) => question.trim())
    .filter(Boolean)
    .slice(0, 3);

  const guidance = [
    asset.description ? `业务背景：${asset.description}` : null,
    asset.primaryKey
      ? `主键 / 唯一标识：${asset.primaryKey}`
      : '请先确认唯一标识字段，避免问答与建模口径歧义。',
    `字段规模：${asset.fieldCount} 个字段。`,
    asset.relationCount
      ? `当前已声明 ${asset.relationCount} 个关系字段，可优先沿用现有关系。`
      : '若会参与跨主题问答，建议优先补齐关系字段。',
    `来源对象：${resolveAssetSourceName(asset)}。`,
  ].filter(Boolean);

  const questionBlock =
    suggestedQuestions.length > 0
      ? `\n\n优先覆盖的典型问法：\n${suggestedQuestions
          .map((question) => `- ${question}`)
          .join('\n')}`
      : '';

  return {
    summary: suggestedQuestions[0] || `${asset.name} 的业务规则`,
    scope: 'matched',
    content: `${guidance.join('\n')}${questionBlock}`.trim(),
  };
};

export const filterKnowledgeSqlTemplates = ({
  sqlList,
  keyword,
  mode = 'all',
}: {
  sqlList: SqlPair[];
  keyword?: string;
  mode?: 'all' | 'recent';
}) => {
  const normalizedKeyword = collapseWhitespace(keyword).toLowerCase();
  const filtered = sortByUpdatedAtDesc(sqlList).filter((sqlPair) => {
    if (!normalizedKeyword) {
      return true;
    }

    return [sqlPair.question, sqlPair.sql]
      .map((value) => collapseWhitespace(value).toLowerCase())
      .some((value) => value.includes(normalizedKeyword));
  });

  return mode === 'recent' ? filtered.slice(0, RECENT_LIST_LIMIT) : filtered;
};

export const filterKnowledgeInstructions = ({
  ruleList,
  keyword,
  scope = 'all',
}: {
  ruleList: Instruction[];
  keyword?: string;
  scope?: 'all' | 'default' | 'matched';
}) => {
  const normalizedKeyword = collapseWhitespace(keyword).toLowerCase();
  return sortByUpdatedAtDesc(ruleList).filter((instruction) => {
    if (scope === 'default' && !instruction.isDefault) {
      return false;
    }

    if (scope === 'matched' && instruction.isDefault) {
      return false;
    }

    if (!normalizedKeyword) {
      return true;
    }

    const draft = parseInstructionDraft(instruction);
    return [draft.summary, draft.content, ...(instruction.questions || [])]
      .map((value) => collapseWhitespace(value).toLowerCase())
      .some((value) => value.includes(normalizedKeyword));
  });
};

export const hasSqlTemplateDraftChanges = ({
  currentValues,
  editingSqlPair,
  initialValues,
}: {
  currentValues?: Partial<SqlTemplateFormValues> | null;
  editingSqlPair?: SqlPair | null;
  initialValues?: Partial<SqlTemplateFormValues> | null;
}) => {
  const resolvedInitialValues: SqlTemplateFormValues = {
    ...EMPTY_SQL_TEMPLATE_VALUES,
    ...(editingSqlPair
      ? {
          sql: editingSqlPair.sql || '',
          description: editingSqlPair.question || '',
        }
      : null),
    ...(initialValues || null),
  };

  return (
    collapseWhitespace(currentValues?.description) !==
      collapseWhitespace(resolvedInitialValues.description) ||
    collapseWhitespace(currentValues?.sql) !==
      collapseWhitespace(resolvedInitialValues.sql) ||
    (currentValues?.scope || 'all') !== resolvedInitialValues.scope
  );
};

export const hasRuleDraftChanges = ({
  currentValues,
  editingInstruction,
  initialValues,
}: {
  currentValues?: Partial<RuleDetailFormValues> | null;
  editingInstruction?: Instruction | null;
  initialValues?: Partial<RuleDetailFormValues> | null;
}) => {
  const resolvedInitialValues: RuleDetailFormValues = {
    ...EMPTY_RULE_EDITOR_VALUES,
    ...(editingInstruction ? parseInstructionDraft(editingInstruction) : null),
    ...(initialValues || null),
  };

  return (
    collapseWhitespace(currentValues?.summary) !==
      collapseWhitespace(resolvedInitialValues.summary) ||
    collapseWhitespace(currentValues?.content) !==
      collapseWhitespace(resolvedInitialValues.content) ||
    (currentValues?.scope || 'all') !== resolvedInitialValues.scope
  );
};

export const summarizeAssetFieldGovernance = (
  fields: Array<
    Pick<
      AssetFieldView,
      'note' | 'isPrimaryKey' | 'isCalculated' | 'nestedFields'
    >
  >,
) => {
  const totalCount = fields.length;
  const notedCount = fields.filter((field) =>
    collapseWhitespace(field.note),
  ).length;
  const primaryCount = fields.filter((field) => field.isPrimaryKey).length;
  const calculatedCount = fields.filter((field) => field.isCalculated).length;
  const nestedCount = fields.filter(
    (field) => (field.nestedFields || []).length > 0,
  ).length;

  return {
    totalCount,
    notedCount,
    missingNoteCount: Math.max(totalCount - notedCount, 0),
    primaryCount,
    calculatedCount,
    nestedCount,
  };
};
