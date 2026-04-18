import {
  buildRuntimeScopeUrl,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import type {
  CreateInstructionInput,
  CreateSqlPairInput,
  Instruction,
  SqlPair,
} from '@/types/knowledge';
type InstructionRestPayload = Partial<
  Pick<
    Instruction,
    'id' | 'instruction' | 'questions' | 'isDefault' | 'createdAt' | 'updatedAt'
  >
> & {
  isGlobal?: boolean | null;
};

type SqlPairRestPayload = Partial<
  Pick<SqlPair, 'id' | 'question' | 'sql' | 'createdAt' | 'updatedAt'>
>;

const buildInstructionsCollectionUrl = (selector: ClientRuntimeScopeSelector) =>
  buildRuntimeScopeUrl('/api/v1/knowledge/instructions', {}, selector);

const buildInstructionItemUrl = (
  id: string | number,
  selector: ClientRuntimeScopeSelector,
) => buildRuntimeScopeUrl(`/api/v1/knowledge/instructions/${id}`, {}, selector);

const buildSqlPairsCollectionUrl = (selector: ClientRuntimeScopeSelector) =>
  buildRuntimeScopeUrl('/api/v1/knowledge/sql_pairs', {}, selector);

const buildSqlPairItemUrl = (
  id: string | number,
  selector: ClientRuntimeScopeSelector,
) => buildRuntimeScopeUrl(`/api/v1/knowledge/sql_pairs/${id}`, {}, selector);

const buildSqlPairGenerateQuestionUrl = (
  selector: ClientRuntimeScopeSelector,
) =>
  buildRuntimeScopeUrl(
    '/api/v1/knowledge/sql_pairs/generate-question',
    {},
    selector,
  );

const normalizeInstructionItem = (
  payload: InstructionRestPayload,
): Instruction | null => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const parsedId = Number(payload.id);
  if (!Number.isFinite(parsedId)) {
    return null;
  }

  return {
    id: parsedId,
    instruction:
      typeof payload.instruction === 'string' ? payload.instruction : '',
    questions: Array.isArray(payload.questions)
      ? payload.questions.filter(
          (question): question is string => typeof question === 'string',
        )
      : [],
    isDefault:
      typeof payload.isDefault === 'boolean'
        ? payload.isDefault
        : Boolean(payload.isGlobal),
    createdAt: typeof payload.createdAt === 'string' ? payload.createdAt : '',
    updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : '',
  };
};

const normalizeInstructionsPayload = (payload: unknown): Instruction[] => {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((item) => normalizeInstructionItem(item as InstructionRestPayload))
    .filter((item): item is Instruction => Boolean(item));
};

const normalizeSqlPairItem = (payload: SqlPairRestPayload): SqlPair | null => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const parsedId = Number(payload.id);
  if (!Number.isFinite(parsedId)) {
    return null;
  }

  return {
    id: parsedId,
    question: typeof payload.question === 'string' ? payload.question : '',
    sql: typeof payload.sql === 'string' ? payload.sql : '',
    createdAt: typeof payload.createdAt === 'string' ? payload.createdAt : null,
    updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : null,
  };
};

const normalizeSqlPairsPayload = (payload: unknown): SqlPair[] => {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map((item) => normalizeSqlPairItem(item as SqlPairRestPayload))
    .filter((item): item is SqlPair => Boolean(item));
};

export const parseKnowledgeRuleSqlRestResponse = async <TPayload>(
  response: Response,
  fallbackMessage: string,
): Promise<TPayload> => {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      (payload as { error?: string } | null)?.error || fallbackMessage,
    );
  }

  return payload as TPayload;
};

export const listKnowledgeInstructions = async (
  selector: ClientRuntimeScopeSelector,
) => {
  const response = await fetch(buildInstructionsCollectionUrl(selector));
  const payload = await parseKnowledgeRuleSqlRestResponse<unknown>(
    response,
    '加载分析规则失败，请稍后重试。',
  );

  return normalizeInstructionsPayload(payload);
};

export const createKnowledgeInstruction = async (
  selector: ClientRuntimeScopeSelector,
  data: CreateInstructionInput,
) => {
  const response = await fetch(buildInstructionsCollectionUrl(selector), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instruction: data.instruction,
      questions: data.isDefault ? [] : data.questions,
      isGlobal: data.isDefault,
    }),
  });

  return parseKnowledgeRuleSqlRestResponse<InstructionRestPayload>(
    response,
    '创建分析规则失败，请稍后重试。',
  );
};

export const updateKnowledgeInstruction = async (
  selector: ClientRuntimeScopeSelector,
  id: number,
  data: CreateInstructionInput,
) => {
  const response = await fetch(buildInstructionItemUrl(id, selector), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instruction: data.instruction,
      questions: data.isDefault ? [] : data.questions,
      isGlobal: data.isDefault,
    }),
  });

  return parseKnowledgeRuleSqlRestResponse<InstructionRestPayload>(
    response,
    '更新分析规则失败，请稍后重试。',
  );
};

export const deleteKnowledgeInstruction = async (
  selector: ClientRuntimeScopeSelector,
  id: number,
) => {
  const response = await fetch(buildInstructionItemUrl(id, selector), {
    method: 'DELETE',
  });

  return parseKnowledgeRuleSqlRestResponse<unknown>(
    response,
    '删除分析规则失败，请稍后重试。',
  );
};

export const listKnowledgeSqlPairs = async (
  selector: ClientRuntimeScopeSelector,
) => {
  const response = await fetch(buildSqlPairsCollectionUrl(selector));
  const payload = await parseKnowledgeRuleSqlRestResponse<unknown>(
    response,
    '加载 SQL 模板失败，请稍后重试。',
  );

  return normalizeSqlPairsPayload(payload);
};

export const createKnowledgeSqlPair = async (
  selector: ClientRuntimeScopeSelector,
  data: CreateSqlPairInput,
) => {
  const response = await fetch(buildSqlPairsCollectionUrl(selector), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  return parseKnowledgeRuleSqlRestResponse<SqlPairRestPayload>(
    response,
    '创建 SQL 模板失败，请稍后重试。',
  );
};

export const updateKnowledgeSqlPair = async (
  selector: ClientRuntimeScopeSelector,
  id: number,
  data: CreateSqlPairInput,
) => {
  const response = await fetch(buildSqlPairItemUrl(id, selector), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  return parseKnowledgeRuleSqlRestResponse<SqlPairRestPayload>(
    response,
    '更新 SQL 模板失败，请稍后重试。',
  );
};

export const deleteKnowledgeSqlPair = async (
  selector: ClientRuntimeScopeSelector,
  id: number,
) => {
  const response = await fetch(buildSqlPairItemUrl(id, selector), {
    method: 'DELETE',
  });

  return parseKnowledgeRuleSqlRestResponse<unknown>(
    response,
    '删除 SQL 模板失败，请稍后重试。',
  );
};

export const generateKnowledgeSqlPairQuestion = async (
  selector: ClientRuntimeScopeSelector,
  sql: string,
) => {
  const response = await fetch(buildSqlPairGenerateQuestionUrl(selector), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  });

  const payload = await parseKnowledgeRuleSqlRestResponse<{
    question?: string;
  }>(response, '生成问题失败，请稍后重试。');

  return payload.question || '';
};
