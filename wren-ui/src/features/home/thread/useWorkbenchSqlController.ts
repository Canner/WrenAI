import { useCallback } from 'react';
import type { ThreadResponse } from '@/types/home';
import type { DataSourceName } from '@/types/dataSource';
import useNativeSQL from '@/hooks/useNativeSQL';
import { usePromptThreadActionsStore } from '@/components/pages/home/promptThread/store';
import { appMessage } from '@/utils/antdAppBridge';
import { useThreadWorkbenchMessages } from './threadWorkbenchMessages';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { resolveThreadResponseRuntimeSelector } from './threadResponseRuntime';

export type WorkbenchSqlController = {
  connectionType?: DataSourceName;
  displayedSql: string;
  loading: boolean;
  nativeSQLMode: boolean;
  onChangeNativeSQL: (checked: boolean) => Promise<void>;
  onCopySql: () => Promise<void>;
  onOpenAdjustSqlModal: () => void;
  showNativeSQL: boolean;
  sqlText: string;
};

export const useWorkbenchSqlController = (
  threadResponse: ThreadResponse,
): WorkbenchSqlController => {
  const messages = useThreadWorkbenchMessages();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const responseRuntimeSelector = resolveThreadResponseRuntimeSelector({
    response: threadResponse,
    fallbackSelector: runtimeScopeNavigation.selector,
  });
  const { onOpenAdjustSQLModal } = usePromptThreadActionsStore();
  const { fetchNativeSQL, nativeSQLResult } = useNativeSQL(
    responseRuntimeSelector,
  );
  const { id, sql } = threadResponse;
  const sqlText = sql ?? '';

  const displayedSql =
    nativeSQLResult.nativeSQLMode && nativeSQLResult.loading === false
      ? nativeSQLResult.data
      : sqlText;

  const onChangeNativeSQL = useCallback(
    async (checked: boolean) => {
      nativeSQLResult.setNativeSQLMode(checked);
      if (!checked) {
        return;
      }
      await fetchNativeSQL({ variables: { responseId: id } });
    },
    [fetchNativeSQL, id, nativeSQLResult],
  );

  const onCopySql = useCallback(async () => {
    const nextSql = displayedSql?.trim();
    if (!nextSql) {
      appMessage.warning(messages.sql.copyFailed);
      return;
    }

    try {
      if (!globalThis.navigator?.clipboard) {
        throw new Error('Clipboard is unavailable');
      }
      await globalThis.navigator.clipboard.writeText(displayedSql);
      appMessage.success(messages.sql.copied);
    } catch {
      appMessage.error(messages.sql.copyFailed);
    }
  }, [displayedSql, messages.sql.copied, messages.sql.copyFailed]);

  const openAdjustSqlModal = useCallback(() => {
    onOpenAdjustSQLModal({ sql: sqlText, responseId: id });
  }, [id, onOpenAdjustSQLModal, sqlText]);

  return {
    connectionType: nativeSQLResult.connectionType,
    displayedSql,
    loading: nativeSQLResult.loading,
    nativeSQLMode: nativeSQLResult.nativeSQLMode,
    onChangeNativeSQL,
    onCopySql,
    onOpenAdjustSqlModal: openAdjustSqlModal,
    showNativeSQL: nativeSQLResult.hasNativeSQL,
    sqlText,
  };
};
