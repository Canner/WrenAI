import { useCallback, useRef, useState } from 'react';
import type { FormInstance } from 'antd';
import type {
  CreateInstructionInput,
  CreateSqlPairInput,
  Instruction,
  SqlPair,
} from '@/types/knowledge';
import {
  EMPTY_RULE_DETAIL_VALUES,
  buildInstructionPayload,
  buildSqlTemplateFormValues,
  buildSqlTemplatePayload,
  findMatchingInstruction,
  findMatchingSqlPair,
  parseInstructionDraft,
  shouldUseRuleSqlListCache,
  type RuleDetailFormValues,
  type SqlTemplateFormValues,
} from './knowledgeRuleSqlManagerUtils';

export {
  parseInstructionDraft,
  shouldUseRuleSqlListCache,
  type RuleDetailFormValues,
  type SqlTemplateFormValues,
} from './knowledgeRuleSqlManagerUtils';

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
