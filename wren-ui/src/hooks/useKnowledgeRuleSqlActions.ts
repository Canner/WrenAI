import { useCallback, useState } from 'react';

import { appMessage as message } from '@/utils/antdAppBridge';
import type {
  CreateInstructionInput,
  CreateSqlPairInput,
  Instruction,
  SqlPair,
} from '@/types/knowledge';
import {
  hasExplicitRuntimeScopeSelector,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import useProtectedRuntimeScopePage from './useProtectedRuntimeScopePage';
import {
  createKnowledgeInstruction,
  createKnowledgeSqlPair,
  deleteKnowledgeInstruction,
  deleteKnowledgeSqlPair,
  listKnowledgeInstructions,
  listKnowledgeSqlPairs,
  updateKnowledgeInstruction,
  updateKnowledgeSqlPair,
} from '@/utils/knowledgeRuleSqlRest';

export const buildInstructionCreateArgs = (data: CreateInstructionInput) => ({
  data,
});

export const buildInstructionUpdateArgs = (
  id: number,
  data: CreateInstructionInput,
) => ({
  id,
  data,
});

export const buildInstructionDeleteArgs = (id: number) => ({
  id,
});

export const buildSqlPairCreateArgs = (data: CreateSqlPairInput) => ({
  data,
});

export const buildSqlPairUpdateArgs = (
  id: number,
  data: CreateSqlPairInput,
) => ({
  id,
  data,
});

export const buildSqlPairDeleteArgs = (id: number) => ({
  id,
});

const buildEmptyInstructionResult = () => ({
  data: {
    instructions: [] as Instruction[],
  },
});

const buildEmptySqlPairResult = () => ({
  data: {
    sqlPairs: [] as SqlPair[],
  },
});

export const hasKnowledgeRuleSqlScope = (
  selector: ClientRuntimeScopeSelector,
) =>
  hasExplicitRuntimeScopeSelector(selector) &&
  Boolean(selector.knowledgeBaseId);

export default function useKnowledgeRuleSqlActions(
  selector: ClientRuntimeScopeSelector,
) {
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const [createInstructionLoading, setCreateInstructionLoading] =
    useState(false);
  const [updateInstructionLoading, setUpdateInstructionLoading] =
    useState(false);
  const [createSqlPairLoading, setCreateSqlPairLoading] = useState(false);
  const [updateSqlPairLoading, setUpdateSqlPairLoading] = useState(false);

  const refetchInstructions = useCallback(async () => {
    if (
      !runtimeScopePage.hasRuntimeScope ||
      !hasKnowledgeRuleSqlScope(selector)
    ) {
      return buildEmptyInstructionResult();
    }

    try {
      const instructions = await listKnowledgeInstructions(selector);
      return {
        data: {
          instructions,
        },
      };
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '加载分析规则失败，请稍后重试。',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
      return buildEmptyInstructionResult();
    }
  }, [runtimeScopePage.hasRuntimeScope, selector]);

  const refetchSqlPairs = useCallback(async () => {
    if (
      !runtimeScopePage.hasRuntimeScope ||
      !hasKnowledgeRuleSqlScope(selector)
    ) {
      return buildEmptySqlPairResult();
    }

    try {
      const sqlPairs = await listKnowledgeSqlPairs(selector);
      return {
        data: {
          sqlPairs,
        },
      };
    } catch (error: any) {
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '加载 SQL 模板失败，请稍后重试。',
      );
      if (errorMessage) {
        message.error(errorMessage);
      }
      return buildEmptySqlPairResult();
    }
  }, [runtimeScopePage.hasRuntimeScope, selector]);

  const createInstruction = useCallback(
    async (data: CreateInstructionInput) => {
      setCreateInstructionLoading(true);
      try {
        await createKnowledgeInstruction(selector, data);
        message.success('已添加分析规则');
      } catch (error: any) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '创建分析规则失败，请稍后重试。',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
        throw error;
      } finally {
        setCreateInstructionLoading(false);
      }
    },
    [selector],
  );

  const updateInstruction = useCallback(
    async (id: number, data: CreateInstructionInput) => {
      setUpdateInstructionLoading(true);
      try {
        await updateKnowledgeInstruction(selector, id, data);
        message.success('已更新分析规则');
      } catch (error: any) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '更新分析规则失败，请稍后重试。',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
        throw error;
      } finally {
        setUpdateInstructionLoading(false);
      }
    },
    [selector],
  );

  const deleteInstruction = useCallback(
    async (id: number) => {
      try {
        await deleteKnowledgeInstruction(selector, id);
        message.success('已删除分析规则');
      } catch (error: any) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '删除分析规则失败，请稍后重试。',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
        throw error;
      }
    },
    [selector],
  );

  const createSqlPair = useCallback(
    async (data: CreateSqlPairInput) => {
      setCreateSqlPairLoading(true);
      try {
        await createKnowledgeSqlPair(selector, data);
        message.success('已添加 SQL 模板');
      } catch (error: any) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '创建 SQL 模板失败，请稍后重试。',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
        throw error;
      } finally {
        setCreateSqlPairLoading(false);
      }
    },
    [selector],
  );

  const updateSqlPair = useCallback(
    async (id: number, data: CreateSqlPairInput) => {
      setUpdateSqlPairLoading(true);
      try {
        await updateKnowledgeSqlPair(selector, id, data);
        message.success('已更新 SQL 模板');
      } catch (error: any) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '更新 SQL 模板失败，请稍后重试。',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
        throw error;
      } finally {
        setUpdateSqlPairLoading(false);
      }
    },
    [selector],
  );

  const deleteSqlPair = useCallback(
    async (id: number) => {
      try {
        await deleteKnowledgeSqlPair(selector, id);
        message.success('已删除 SQL 模板');
      } catch (error: any) {
        const errorMessage = resolveAbortSafeErrorMessage(
          error,
          '删除 SQL 模板失败，请稍后重试。',
        );
        if (errorMessage) {
          message.error(errorMessage);
        }
        throw error;
      }
    },
    [selector],
  );

  return {
    createInstructionLoading,
    updateInstructionLoading,
    createSqlPairLoading,
    updateSqlPairLoading,
    refetchInstructions,
    refetchSqlPairs,
    createInstruction,
    updateInstruction,
    deleteInstruction,
    createSqlPair,
    updateSqlPair,
    deleteSqlPair,
  };
}
