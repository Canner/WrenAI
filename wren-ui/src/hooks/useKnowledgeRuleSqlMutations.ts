import { useCallback, useState } from 'react';
import { message } from 'antd';
import type {
  CreateInstructionInput,
  CreateSqlPairInput,
  Instruction,
  SqlPair,
} from '@/apollo/client/graphql/__types__';
import type { ClientRuntimeScopeSelector } from '@/apollo/client/runtimeScope';
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

export const buildInstructionCreateVariables = (
  data: CreateInstructionInput,
) => ({
  variables: { data },
});

export const buildInstructionUpdateVariables = (
  id: number,
  data: CreateInstructionInput,
) => ({
  variables: {
    where: { id },
    data,
  },
});

export const buildInstructionDeleteVariables = (id: number) => ({
  variables: {
    where: { id },
  },
});

export const buildSqlPairCreateVariables = (data: CreateSqlPairInput) => ({
  variables: { data },
});

export const buildSqlPairUpdateVariables = (
  id: number,
  data: CreateSqlPairInput,
) => ({
  variables: {
    where: { id },
    data,
  },
});

export const buildSqlPairDeleteVariables = (id: number) => ({
  variables: {
    where: { id },
  },
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

export default function useKnowledgeRuleSqlMutations(
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
    if (!runtimeScopePage.hasRuntimeScope) {
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
      message.error(error?.message || '加载分析规则失败，请稍后重试。');
      return buildEmptyInstructionResult();
    }
  }, [runtimeScopePage.hasRuntimeScope, selector]);

  const refetchSqlPairs = useCallback(async () => {
    if (!runtimeScopePage.hasRuntimeScope) {
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
      message.error(error?.message || '加载 SQL 模板失败，请稍后重试。');
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
        message.error(error?.message || '创建分析规则失败，请稍后重试。');
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
        message.error(error?.message || '更新分析规则失败，请稍后重试。');
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
        message.error(error?.message || '删除分析规则失败，请稍后重试。');
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
        message.error(error?.message || '创建 SQL 模板失败，请稍后重试。');
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
        message.error(error?.message || '更新 SQL 模板失败，请稍后重试。');
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
        message.error(error?.message || '删除 SQL 模板失败，请稍后重试。');
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
