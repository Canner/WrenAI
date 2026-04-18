import { useCallback, useRef, useState } from 'react';
import type { FormInstance } from 'antd';
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
const EMPTY_RULE_DETAIL_VALUES: RuleDetailFormValues = {
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

const buildInstructionPayload = (
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

const buildSqlTemplatePayload = (
  values: SqlTemplateFormValues,
): CreateSqlPairInput => ({
  sql: values.sql,
  question: values.description,
});

const buildSqlTemplateFormValues = (
  sqlPair?: SqlPair | null,
): SqlTemplateFormValues => ({
  sql: sqlPair?.sql || '',
  scope: 'all',
  description: sqlPair?.question || '',
});

const hasSameQuestions = (left: string[] = [], right: string[] = []) =>
  left.length === right.length &&
  left.every((question, index) => question === right[index]);

const findMatchingInstruction = ({
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

const findMatchingSqlPair = ({
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

export default function useKnowledgeRuleSqlManager({
  ruleForm,
  sqlTemplateForm,
  cacheScopeKey,
  refetchInstructions,
  refetchSqlPairs,
  createInstruction,
  updateInstruction,
  deleteInstruction,
  createSqlPair,
  updateSqlPair,
  deleteSqlPair,
}: {
  ruleForm: FormInstance<RuleDetailFormValues>;
  sqlTemplateForm: FormInstance<SqlTemplateFormValues>;
  cacheScopeKey?: string | null;
  refetchInstructions: () => Promise<{
    data?: { instructions?: Instruction[] | null } | null;
  }>;
  refetchSqlPairs: () => Promise<{
    data?: { sqlPairs?: SqlPair[] | null } | null;
  }>;
  createInstruction: (data: CreateInstructionInput) => Promise<unknown>;
  updateInstruction: (
    id: number,
    data: CreateInstructionInput,
  ) => Promise<unknown>;
  deleteInstruction: (id: number) => Promise<unknown>;
  createSqlPair: (data: CreateSqlPairInput) => Promise<unknown>;
  updateSqlPair: (id: number, data: CreateSqlPairInput) => Promise<unknown>;
  deleteSqlPair: (id: number) => Promise<unknown>;
}) {
  const [editingInstruction, setEditingInstruction] =
    useState<Instruction | null>(null);
  const [ruleManageLoading, setRuleManageLoading] = useState(false);
  const [ruleList, setRuleList] = useState<Instruction[]>([]);
  const [editingSqlPair, setEditingSqlPair] = useState<SqlPair | null>(null);
  const [sqlManageLoading, setSqlManageLoading] = useState(false);
  const [sqlList, setSqlList] = useState<SqlPair[]>([]);
  const ruleListLoadedAtRef = useRef(0);
  const sqlListLoadedAtRef = useRef(0);
  const ruleListScopeKeyRef = useRef<string | null>(null);
  const sqlListScopeKeyRef = useRef<string | null>(null);
  const pendingRuleListRequestRef = useRef<Promise<Instruction[]> | null>(null);
  const pendingSqlListRequestRef = useRef<Promise<SqlPair[]> | null>(null);

  const applyRuleFormValues = useCallback(
    (instruction?: Instruction | null) => {
      const draft = instruction
        ? parseInstructionDraft(instruction)
        : EMPTY_RULE_DETAIL_VALUES;
      ruleForm.setFieldsValue({
        summary: draft.summary,
        scope: draft.scope,
        content: draft.content,
      });
    },
    [ruleForm],
  );

  const applySqlTemplateFormValues = useCallback(
    (sqlPair?: SqlPair | null) => {
      const draft = buildSqlTemplateFormValues(sqlPair);
      sqlTemplateForm.setFieldsValue({
        sql: draft.sql,
        scope: draft.scope,
        description: draft.description,
      });
    },
    [sqlTemplateForm],
  );

  const loadRuleList = useCallback(async () => {
    const forceRefresh = false;
    if (
      shouldUseRuleSqlListCache({
        forceRefresh,
        lastLoadedAt: ruleListLoadedAtRef.current,
        lastLoadedScopeKey: ruleListScopeKeyRef.current,
        currentScopeKey: cacheScopeKey,
      })
    ) {
      return ruleList;
    }

    if (pendingRuleListRequestRef.current) {
      return pendingRuleListRequestRef.current;
    }

    setRuleManageLoading(true);
    const request = refetchInstructions()
      .then((result) => {
        const nextRuleList = (result.data?.instructions || []) as Instruction[];
        setRuleList(nextRuleList);
        ruleListLoadedAtRef.current = Date.now();
        ruleListScopeKeyRef.current = cacheScopeKey || null;
        return nextRuleList;
      })
      .finally(() => {
        pendingRuleListRequestRef.current = null;
        setRuleManageLoading(false);
      });
    pendingRuleListRequestRef.current = request;
    return request;
  }, [cacheScopeKey, refetchInstructions, ruleList]);

  const forceReloadRuleList = useCallback(async () => {
    if (pendingRuleListRequestRef.current) {
      return pendingRuleListRequestRef.current;
    }

    setRuleManageLoading(true);
    const request = refetchInstructions()
      .then((result) => {
        const nextRuleList = (result.data?.instructions || []) as Instruction[];
        setRuleList(nextRuleList);
        ruleListLoadedAtRef.current = Date.now();
        ruleListScopeKeyRef.current = cacheScopeKey || null;
        return nextRuleList;
      })
      .finally(() => {
        pendingRuleListRequestRef.current = null;
        setRuleManageLoading(false);
      });
    pendingRuleListRequestRef.current = request;
    return request;
  }, [cacheScopeKey, refetchInstructions]);

  const loadSqlList = useCallback(async () => {
    const forceRefresh = false;
    if (
      shouldUseRuleSqlListCache({
        forceRefresh,
        lastLoadedAt: sqlListLoadedAtRef.current,
        lastLoadedScopeKey: sqlListScopeKeyRef.current,
        currentScopeKey: cacheScopeKey,
      })
    ) {
      return sqlList;
    }

    if (pendingSqlListRequestRef.current) {
      return pendingSqlListRequestRef.current;
    }

    setSqlManageLoading(true);
    const request = refetchSqlPairs()
      .then((result) => {
        const nextSqlList = (result.data?.sqlPairs || []) as SqlPair[];
        setSqlList(nextSqlList);
        sqlListLoadedAtRef.current = Date.now();
        sqlListScopeKeyRef.current = cacheScopeKey || null;
        return nextSqlList;
      })
      .finally(() => {
        pendingSqlListRequestRef.current = null;
        setSqlManageLoading(false);
      });
    pendingSqlListRequestRef.current = request;
    return request;
  }, [cacheScopeKey, refetchSqlPairs, sqlList]);

  const forceReloadSqlList = useCallback(async () => {
    if (pendingSqlListRequestRef.current) {
      return pendingSqlListRequestRef.current;
    }

    setSqlManageLoading(true);
    const request = refetchSqlPairs()
      .then((result) => {
        const nextSqlList = (result.data?.sqlPairs || []) as SqlPair[];
        setSqlList(nextSqlList);
        sqlListLoadedAtRef.current = Date.now();
        sqlListScopeKeyRef.current = cacheScopeKey || null;
        return nextSqlList;
      })
      .finally(() => {
        pendingSqlListRequestRef.current = null;
        setSqlManageLoading(false);
      });
    pendingSqlListRequestRef.current = request;
    return request;
  }, [cacheScopeKey, refetchSqlPairs]);

  const openRuleManageModal = useCallback(() => {
    setEditingInstruction(null);
    applyRuleFormValues(null);
    void loadRuleList();
  }, [applyRuleFormValues, loadRuleList]);

  const closeRuleManageModal = useCallback(() => {
    setEditingInstruction(null);
    applyRuleFormValues(null);
  }, [applyRuleFormValues]);

  const openSqlManageModal = useCallback(() => {
    setEditingSqlPair(null);
    applySqlTemplateFormValues(null);
    void loadSqlList();
  }, [applySqlTemplateFormValues, loadSqlList]);

  const closeSqlManageModal = useCallback(() => {
    setEditingSqlPair(null);
    applySqlTemplateFormValues(null);
  }, [applySqlTemplateFormValues]);

  const openRuleDetail = useCallback(
    (instruction?: Instruction) => {
      const nextInstruction = instruction || null;
      setEditingInstruction(nextInstruction);
      applyRuleFormValues(nextInstruction);
    },
    [applyRuleFormValues],
  );

  const closeRuleDetail = useCallback(() => {
    applyRuleFormValues(null);
    setEditingInstruction(null);
  }, [applyRuleFormValues]);

  const backToRuleManageModal = useCallback(() => {
    closeRuleDetail();
    void forceReloadRuleList();
  }, [closeRuleDetail, forceReloadRuleList]);

  const openSqlTemplateDetail = useCallback(
    (sqlPair?: SqlPair) => {
      const nextSqlPair = sqlPair || null;
      setEditingSqlPair(nextSqlPair);
      applySqlTemplateFormValues(nextSqlPair);
    },
    [applySqlTemplateFormValues],
  );

  const closeSqlDetail = useCallback(() => {
    applySqlTemplateFormValues(null);
    setEditingSqlPair(null);
  }, [applySqlTemplateFormValues]);

  const backToSqlManageModal = useCallback(() => {
    closeSqlDetail();
    void forceReloadSqlList();
  }, [closeSqlDetail, forceReloadSqlList]);

  const handleDeleteRule = useCallback(
    async (instruction: Instruction) => {
      await deleteInstruction(instruction.id);
      const nextRuleList = await forceReloadRuleList();

      if (editingInstruction?.id === instruction.id) {
        const nextInstruction = nextRuleList[0] || null;
        setEditingInstruction(nextInstruction);
        applyRuleFormValues(nextInstruction);
      }
    },
    [
      applyRuleFormValues,
      deleteInstruction,
      editingInstruction?.id,
      forceReloadRuleList,
    ],
  );

  const handleDeleteSqlTemplate = useCallback(
    async (sqlPair: SqlPair) => {
      await deleteSqlPair(sqlPair.id);
      const nextSqlList = await forceReloadSqlList();

      if (editingSqlPair?.id === sqlPair.id) {
        const nextSqlPair = nextSqlList[0] || null;
        setEditingSqlPair(nextSqlPair);
        applySqlTemplateFormValues(nextSqlPair);
      }
    },
    [
      applySqlTemplateFormValues,
      deleteSqlPair,
      editingSqlPair?.id,
      forceReloadSqlList,
    ],
  );

  const submitRuleDetail = useCallback(async () => {
    const values = await ruleForm.validateFields();
    const data = buildInstructionPayload(values);
    const editingId = editingInstruction?.id;

    if (editingId) {
      await updateInstruction(editingId, data);
    } else {
      await createInstruction(data);
    }

    const nextRuleList = await forceReloadRuleList();
    const nextInstruction = findMatchingInstruction({
      ruleList: nextRuleList,
      editingId,
      payload: data,
    });
    setEditingInstruction(nextInstruction);
    applyRuleFormValues(nextInstruction);
  }, [
    applyRuleFormValues,
    createInstruction,
    editingInstruction?.id,
    forceReloadRuleList,
    ruleForm,
    updateInstruction,
  ]);

  const submitSqlTemplateDetail = useCallback(async () => {
    const values = await sqlTemplateForm.validateFields();
    const data = buildSqlTemplatePayload(values);
    const editingId = editingSqlPair?.id;

    if (editingId) {
      await updateSqlPair(editingId, data);
    } else {
      await createSqlPair(data);
    }

    const nextSqlList = await forceReloadSqlList();
    const nextSqlPair = findMatchingSqlPair({
      sqlList: nextSqlList,
      editingId,
      payload: data,
    });
    setEditingSqlPair(nextSqlPair);
    applySqlTemplateFormValues(nextSqlPair);
  }, [
    applySqlTemplateFormValues,
    createSqlPair,
    editingSqlPair?.id,
    forceReloadSqlList,
    sqlTemplateForm,
    updateSqlPair,
  ]);

  const resetRuleSqlManagerState = useCallback(() => {
    setRuleManageLoading(false);
    setRuleList([]);
    setEditingInstruction(null);
    setSqlManageLoading(false);
    setSqlList([]);
    setEditingSqlPair(null);
    ruleListLoadedAtRef.current = 0;
    sqlListLoadedAtRef.current = 0;
    ruleListScopeKeyRef.current = null;
    sqlListScopeKeyRef.current = null;
    pendingRuleListRequestRef.current = null;
    pendingSqlListRequestRef.current = null;
    applyRuleFormValues(null);
    applySqlTemplateFormValues(null);
  }, [applyRuleFormValues, applySqlTemplateFormValues]);

  const resetRuleDetailEditor = useCallback(() => {
    applyRuleFormValues(null);
    setEditingInstruction(null);
  }, [applyRuleFormValues]);

  const resetSqlTemplateEditor = useCallback(() => {
    applySqlTemplateFormValues(null);
    setEditingSqlPair(null);
  }, [applySqlTemplateFormValues]);

  return {
    editingInstruction,
    ruleManageLoading,
    ruleList,
    loadRuleList,
    forceReloadRuleList,
    editingSqlPair,
    sqlManageLoading,
    sqlList,
    loadSqlList,
    forceReloadSqlList,
    openRuleManageModal,
    closeRuleManageModal,
    openSqlManageModal,
    closeSqlManageModal,
    openRuleDetail,
    closeRuleDetail,
    backToRuleManageModal,
    openSqlTemplateDetail,
    closeSqlDetail,
    backToSqlManageModal,
    handleDeleteRule,
    handleDeleteSqlTemplate,
    submitRuleDetail,
    submitSqlTemplateDetail,
    resetRuleDetailEditor,
    resetSqlTemplateEditor,
    resetRuleSqlManagerState,
  };
}
