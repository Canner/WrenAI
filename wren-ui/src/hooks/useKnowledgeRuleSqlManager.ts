import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormInstance } from 'antd';
import type {
  CreateInstructionInput,
  CreateSqlPairInput,
  Instruction,
  SqlPair,
} from '@/types/api';

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

export const shouldUseRuleSqlListCache = ({
  forceRefresh,
  cachedCount,
  lastLoadedAt,
  now = Date.now(),
  ttlMs = RULE_SQL_LIST_CACHE_TTL_MS,
}: {
  forceRefresh: boolean;
  cachedCount: number;
  lastLoadedAt: number;
  now?: number;
  ttlMs?: number;
}) =>
  !forceRefresh &&
  cachedCount > 0 &&
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

export default function useKnowledgeRuleSqlManager({
  ruleForm,
  sqlTemplateForm,
  openModalSafely,
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
  openModalSafely: (action: () => void) => void;
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
  const [ruleManageOpen, setRuleManageOpen] = useState(false);
  const [ruleManageLoading, setRuleManageLoading] = useState(false);
  const [ruleList, setRuleList] = useState<Instruction[]>([]);
  const [ruleDetailOpen, setRuleDetailOpen] = useState(false);
  const [editingSqlPair, setEditingSqlPair] = useState<SqlPair | null>(null);
  const [sqlManageOpen, setSqlManageOpen] = useState(false);
  const [sqlManageLoading, setSqlManageLoading] = useState(false);
  const [sqlList, setSqlList] = useState<SqlPair[]>([]);
  const [sqlDetailOpen, setSqlDetailOpen] = useState(false);
  const ruleListLoadedAtRef = useRef(0);
  const sqlListLoadedAtRef = useRef(0);
  const pendingRuleListRequestRef = useRef<Promise<Instruction[]> | null>(null);
  const pendingSqlListRequestRef = useRef<Promise<SqlPair[]> | null>(null);

  useEffect(() => {
    if (!ruleDetailOpen) {
      return;
    }

    const draft = parseInstructionDraft(editingInstruction);
    ruleForm.setFieldsValue({
      summary: draft.summary,
      scope: draft.scope,
      content: draft.content,
    });
  }, [editingInstruction, ruleDetailOpen, ruleForm]);

  useEffect(() => {
    if (!sqlDetailOpen) {
      return;
    }

    sqlTemplateForm.setFieldsValue({
      sql: editingSqlPair?.sql || '',
      scope: 'all',
      description: editingSqlPair?.question || '',
    });
  }, [editingSqlPair, sqlDetailOpen, sqlTemplateForm]);

  const loadRuleList = useCallback(async () => {
    const forceRefresh = false;
    if (
      shouldUseRuleSqlListCache({
        forceRefresh,
        cachedCount: ruleList.length,
        lastLoadedAt: ruleListLoadedAtRef.current,
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
        return nextRuleList;
      })
      .finally(() => {
        pendingRuleListRequestRef.current = null;
        setRuleManageLoading(false);
      });
    pendingRuleListRequestRef.current = request;
    return request;
  }, [refetchInstructions, ruleList]);

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
        return nextRuleList;
      })
      .finally(() => {
        pendingRuleListRequestRef.current = null;
        setRuleManageLoading(false);
      });
    pendingRuleListRequestRef.current = request;
    return request;
  }, [refetchInstructions]);

  const loadSqlList = useCallback(async () => {
    const forceRefresh = false;
    if (
      shouldUseRuleSqlListCache({
        forceRefresh,
        cachedCount: sqlList.length,
        lastLoadedAt: sqlListLoadedAtRef.current,
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
        return nextSqlList;
      })
      .finally(() => {
        pendingSqlListRequestRef.current = null;
        setSqlManageLoading(false);
      });
    pendingSqlListRequestRef.current = request;
    return request;
  }, [refetchSqlPairs, sqlList]);

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
        return nextSqlList;
      })
      .finally(() => {
        pendingSqlListRequestRef.current = null;
        setSqlManageLoading(false);
      });
    pendingSqlListRequestRef.current = request;
    return request;
  }, [refetchSqlPairs]);

  const openRuleManageModal = useCallback(() => {
    openModalSafely(() => {
      setRuleManageOpen(true);
    });
    void loadRuleList();
  }, [loadRuleList, openModalSafely]);

  const closeRuleManageModal = useCallback(() => {
    setRuleManageOpen(false);
  }, []);

  const openSqlManageModal = useCallback(() => {
    openModalSafely(() => {
      setSqlManageOpen(true);
    });
    void loadSqlList();
  }, [loadSqlList, openModalSafely]);

  const closeSqlManageModal = useCallback(() => {
    setSqlManageOpen(false);
  }, []);

  const openRuleDetail = useCallback(
    (instruction?: Instruction) => {
      setRuleManageOpen(false);
      setEditingInstruction(instruction || null);
      openModalSafely(() => {
        setRuleDetailOpen(true);
      });
    },
    [openModalSafely],
  );

  const closeRuleDetail = useCallback(() => {
    ruleForm.resetFields();
    setRuleDetailOpen(false);
    setEditingInstruction(null);
  }, [ruleForm]);

  const backToRuleManageModal = useCallback(() => {
    closeRuleDetail();
    openModalSafely(() => {
      setRuleManageOpen(true);
    });
    void forceReloadRuleList();
  }, [closeRuleDetail, forceReloadRuleList, openModalSafely]);

  const openSqlTemplateDetail = useCallback(
    (sqlPair?: SqlPair) => {
      setSqlManageOpen(false);
      setEditingSqlPair(sqlPair || null);
      openModalSafely(() => {
        setSqlDetailOpen(true);
      });
    },
    [openModalSafely],
  );

  const closeSqlDetail = useCallback(() => {
    sqlTemplateForm.resetFields();
    setSqlDetailOpen(false);
    setEditingSqlPair(null);
  }, [sqlTemplateForm]);

  const backToSqlManageModal = useCallback(() => {
    closeSqlDetail();
    openModalSafely(() => {
      setSqlManageOpen(true);
    });
    void forceReloadSqlList();
  }, [closeSqlDetail, forceReloadSqlList, openModalSafely]);

  const handleDeleteRule = useCallback(
    async (instruction: Instruction) => {
      await deleteInstruction(instruction.id);
      await forceReloadRuleList();
    },
    [deleteInstruction, forceReloadRuleList],
  );

  const handleDeleteSqlTemplate = useCallback(
    async (sqlPair: SqlPair) => {
      await deleteSqlPair(sqlPair.id);
      await forceReloadSqlList();
    },
    [deleteSqlPair, forceReloadSqlList],
  );

  const submitRuleDetail = useCallback(async () => {
    const values = await ruleForm.validateFields();
    const data = buildInstructionPayload(values);

    if (editingInstruction?.id) {
      await updateInstruction(editingInstruction.id, data);
    } else {
      await createInstruction(data);
    }

    backToRuleManageModal();
  }, [
    backToRuleManageModal,
    createInstruction,
    editingInstruction?.id,
    ruleForm,
    updateInstruction,
  ]);

  const submitSqlTemplateDetail = useCallback(async () => {
    const values = await sqlTemplateForm.validateFields();
    const data = buildSqlTemplatePayload(values);

    if (editingSqlPair?.id) {
      await updateSqlPair(editingSqlPair.id, data);
    } else {
      await createSqlPair(data);
    }

    backToSqlManageModal();
  }, [
    backToSqlManageModal,
    createSqlPair,
    editingSqlPair?.id,
    sqlTemplateForm,
    updateSqlPair,
  ]);

  const resetRuleSqlManagerState = useCallback(() => {
    setRuleManageOpen(false);
    setRuleManageLoading(false);
    setRuleList([]);
    setRuleDetailOpen(false);
    setEditingInstruction(null);
    setSqlManageOpen(false);
    setSqlManageLoading(false);
    setSqlList([]);
    setSqlDetailOpen(false);
    setEditingSqlPair(null);
    ruleListLoadedAtRef.current = 0;
    sqlListLoadedAtRef.current = 0;
    pendingRuleListRequestRef.current = null;
    pendingSqlListRequestRef.current = null;
  }, []);

  return {
    editingInstruction,
    ruleManageOpen,
    ruleManageLoading,
    ruleList,
    ruleDetailOpen,
    editingSqlPair,
    sqlManageOpen,
    sqlManageLoading,
    sqlList,
    sqlDetailOpen,
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
    resetRuleSqlManagerState,
  };
}
