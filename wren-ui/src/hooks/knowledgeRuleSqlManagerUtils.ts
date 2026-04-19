import type {
  CreateInstructionInput,
  CreateSqlPairInput,
  Instruction,
  SqlPair,
} from '@/types/knowledge';

export type RuleDetailFormValues = {
  summary: string;
  scope: 'all' | 'matched';
  content: string;
};

export type SqlTemplateFormValues = {
  sql: string;
  scope: 'all' | 'matched';
  description: string;
};

const INSTRUCTION_SUMMARY_PREFIX = '【规则描述】';
const INSTRUCTION_CONTENT_PREFIX = '【规则内容】';
const RULE_SQL_LIST_CACHE_TTL_MS = 15_000;

export const EMPTY_RULE_DETAIL_VALUES: RuleDetailFormValues = {
  summary: '',
  scope: 'all',
  content: '',
};

export const shouldUseRuleSqlListCache = ({
  forceRefresh,
  lastLoadedAt,
  lastLoadedScopeKey,
  currentScopeKey,
  now = Date.now(),
  ttlMs = RULE_SQL_LIST_CACHE_TTL_MS,
}: {
  forceRefresh: boolean;
  lastLoadedAt: number;
  lastLoadedScopeKey?: string | null;
  currentScopeKey?: string | null;
  now?: number;
  ttlMs?: number;
}) =>
  !forceRefresh &&
  (!currentScopeKey ||
    !lastLoadedScopeKey ||
    currentScopeKey === lastLoadedScopeKey) &&
  lastLoadedAt > 0 &&
  now - lastLoadedAt <= ttlMs;

export const parseInstructionDraft = (
  instruction?: Instruction | null,
): RuleDetailFormValues => {
  const raw = instruction?.instruction?.trim() || '';
  const questions = instruction?.questions || [];
  if (!raw) {
    return {
      summary: '',
      scope: instruction?.isDefault ? 'all' : 'matched',
      content: '',
    };
  }

  if (
    raw.startsWith(INSTRUCTION_SUMMARY_PREFIX) &&
    raw.includes(`\n${INSTRUCTION_CONTENT_PREFIX}`)
  ) {
    const [summaryBlock, ...contentBlocks] = raw.split(
      `\n${INSTRUCTION_CONTENT_PREFIX}`,
    );
    return {
      summary: summaryBlock.replace(INSTRUCTION_SUMMARY_PREFIX, '').trim(),
      scope: instruction?.isDefault ? 'all' : 'matched',
      content: contentBlocks.join(`\n${INSTRUCTION_CONTENT_PREFIX}`).trim(),
    };
  }

  return {
    summary: questions[0] || raw.split('\n')[0] || '未命名规则',
    scope: instruction?.isDefault ? 'all' : 'matched',
    content: raw,
  };
};

export const buildInstructionPayload = (
  values: RuleDetailFormValues,
): CreateInstructionInput => {
  const summary = values.summary.trim() || '未命名规则';
  const content = values.content.trim() || summary;

  return {
    isDefault: values.scope === 'all',
    instruction: `${INSTRUCTION_SUMMARY_PREFIX}${summary}\n${INSTRUCTION_CONTENT_PREFIX}${content}`,
    questions: values.scope === 'all' ? [] : [summary],
  };
};

export const buildSqlTemplatePayload = (
  values: SqlTemplateFormValues,
): CreateSqlPairInput => ({
  sql: values.sql,
  question: values.description,
});

export const buildSqlTemplateFormValues = (
  sqlPair?: SqlPair | null,
): SqlTemplateFormValues => ({
  sql: sqlPair?.sql || '',
  scope: 'all',
  description: sqlPair?.question || '',
});

const hasSameQuestions = (left: string[] = [], right: string[] = []) =>
  left.length === right.length &&
  left.every((question, index) => question === right[index]);

export const findMatchingInstruction = ({
  ruleList,
  editingId,
  payload,
}: {
  ruleList: Instruction[];
  editingId?: number;
  payload: CreateInstructionInput;
}) => {
  if (editingId != null) {
    return ruleList.find((instruction) => instruction.id === editingId) || null;
  }

  return (
    ruleList.find(
      (instruction) =>
        instruction.instruction === payload.instruction &&
        instruction.isDefault === payload.isDefault &&
        hasSameQuestions(instruction.questions, payload.questions),
    ) ||
    ruleList[0] ||
    null
  );
};

export const findMatchingSqlPair = ({
  sqlList,
  editingId,
  payload,
}: {
  sqlList: SqlPair[];
  editingId?: number;
  payload: CreateSqlPairInput;
}) => {
  if (editingId != null) {
    return sqlList.find((sqlPair) => sqlPair.id === editingId) || null;
  }

  return (
    sqlList.find(
      (sqlPair) =>
        sqlPair.sql === payload.sql && sqlPair.question === payload.question,
    ) ||
    sqlList[0] ||
    null
  );
};
