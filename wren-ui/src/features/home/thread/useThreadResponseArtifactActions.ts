import { useCallback, useState } from 'react';

import { appMessage as message } from '@/utils/antdAppBridge';
import type { CreateSqlPairInput } from '@/types/knowledge';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { createKnowledgeSqlPair } from '@/utils/knowledgeRuleSqlRest';
import { createViewFromResponse } from '@/utils/viewRest';

const reportThreadError = (_error: unknown, fallbackMessage: string) => {
  message.error(fallbackMessage);
};

export function useThreadResponseArtifactActions({
  runtimeScopeSelector,
}: {
  runtimeScopeSelector: ClientRuntimeScopeSelector;
}) {
  const [createSqlPairLoading, setCreateSqlPairLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleCreateView = useCallback(
    async (data: {
      name: string;
      rephrasedQuestion: string;
      responseId: number;
    }) => {
      setCreating(true);
      try {
        await createViewFromResponse(runtimeScopeSelector, data);
        message.success('视图已创建。');
      } catch (error) {
        reportThreadError(error, '创建视图失败，请稍后重试');
        throw error;
      } finally {
        setCreating(false);
      }
    },
    [runtimeScopeSelector],
  );

  const handleCreateSqlPair = useCallback(
    async (data: CreateSqlPairInput) => {
      setCreateSqlPairLoading(true);
      try {
        await createKnowledgeSqlPair(runtimeScopeSelector, data);
        message.success('SQL 模板已创建。');
      } catch (error) {
        reportThreadError(error, '保存 SQL 模板失败，请稍后重试');
        throw error;
      } finally {
        setCreateSqlPairLoading(false);
      }
    },
    [runtimeScopeSelector],
  );

  return {
    createSqlPairLoading,
    creating,
    handleCreateSqlPair,
    handleCreateView,
  };
}
