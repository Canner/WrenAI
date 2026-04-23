import { useCallback, useEffect, useMemo, useState } from 'react';
import { appMessage as message } from '@/utils/antdAppBridge';
import useModelList from '@/hooks/useModelList';
import usePollingRequestLoop from '@/hooks/usePollingRequestLoop';
import {
  createRelationshipRecommendationTask,
  fetchRelationshipRecommendationTask,
  saveSetupRelations,
} from '@/utils/modelingRest';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import type { SelectedRecommendRelations } from '@/components/pages/setup/DefineRelations';
import type { RelationFormValues } from '@/components/modals/RelationModal';
import { convertFormValuesToIdentifier } from '@/hooks/useCombineFieldOptions';
import {
  buildRecommendRelationshipsSavePayload,
  buildRecommendRelationshipsViewState,
  hasRecommendRelationshipsResult,
} from './recommendRelationshipsSupport';
import type { RelationshipRecommendationTaskResponse } from '@/types/modelingAssistant';

type ErrorLike = {
  message?: string | null;
};

const resolveTaskErrorMessage = (error?: { message?: string | null } | null) =>
  error?.message ||
  'Failed to load relationship recommendations. Please try again.';

export default function useRecommendRelationshipsTask({
  enabled,
  selector,
  onSaveSuccess,
}: {
  enabled: boolean;
  selector: ClientRuntimeScopeSelector;
  onSaveSuccess: () => void | Promise<void>;
}) {
  const [task, setTask] =
    useState<RelationshipRecommendationTaskResponse | null>(null);
  const [started, setStarted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [editedRelations, setEditedRelations] =
    useState<SelectedRecommendRelations>({});
  const [recommendNameMapping, setRecommendNameMapping] = useState<
    Record<string, string>
  >({});
  const modelList = useModelList({
    enabled,
    onError: (error) => {
      setRequestError(error.message);
      setTask({
        id: task?.id || 'relationship-recommendation-error',
        status: 'FAILED',
        response: null,
        error: {
          message: error.message,
        },
      });
    },
  });

  const {
    startPolling,
    stopPolling,
    loading: polling,
  } = usePollingRequestLoop<RelationshipRecommendationTaskResponse>({
    shouldContinue: (nextTask) => nextTask.status === 'GENERATING',
    onCompleted: (nextTask) => {
      setTask(nextTask);
      if (nextTask.status === 'FAILED') {
        setRequestError(resolveTaskErrorMessage(nextTask.error));
      }
    },
    onError: (error) => {
      setRequestError(error.message);
    },
  });

  const startTask = useCallback(async () => {
    setStarted(true);
    try {
      const result = await createRelationshipRecommendationTask(selector);
      setRequestError(null);
      setTask({
        id: result.id,
        status: 'GENERATING',
        response: null,
        error: null,
      });
      await startPolling(() =>
        fetchRelationshipRecommendationTask(selector, result.id),
      );
    } catch (error) {
      const messageText =
        (error as ErrorLike)?.message ||
        'Failed to load relationship recommendations. Please try again.';
      setRequestError(messageText);
      setTask({
        id: 'relationship-recommendation-error',
        status: 'FAILED',
        response: null,
        error: {
          message: messageText,
        },
      });
    }
  }, [selector, startPolling]);

  const retry = useCallback(async () => {
    stopPolling();
    setStarted(false);
    setTask(null);
    setEditedRelations({});
    setRecommendNameMapping({});
    await startTask();
  }, [startTask, stopPolling]);

  useEffect(() => {
    if (!enabled || started || modelList.loading || !modelList.data) {
      return;
    }
    void startTask();
  }, [enabled, modelList.data, modelList.loading, startTask, started]);

  useEffect(() => {
    if (!task || task.status !== 'FINISHED' || !modelList.data) {
      return;
    }
    const nextViewState = buildRecommendRelationshipsViewState({
      models: modelList.data,
      task,
    });
    setEditedRelations(nextViewState.recommendRelations);
    setRecommendNameMapping(nextViewState.recommendNameMapping);
  }, [modelList.data, task]);

  const hasResult = useMemo(
    () => hasRecommendRelationshipsResult(editedRelations),
    [editedRelations],
  );

  const emptyState = Boolean(task?.status === 'FINISHED' && !hasResult);

  const onDeleteRow = useCallback((modelName: string, relationKey: string) => {
    setEditedRelations((current) => ({
      ...current,
      [modelName]: (current[modelName] || []).filter(
        (relation) =>
          `${relation.fromField.fieldId}-${relation.toField.fieldId}-${relation.type}` !==
          relationKey,
      ),
    }));
  }, []);

  const onUpdateRelation = useCallback(
    ({
      modelName,
      originalRelationKey,
      values,
    }: {
      modelName: string;
      originalRelationKey: string;
      values: RelationFormValues;
    }) => {
      const nextRelation = convertFormValuesToIdentifier(values);
      setEditedRelations((current) => ({
        ...current,
        [modelName]: (current[modelName] || []).map((relation) => {
          const key = `${relation.fromField.fieldId}-${relation.toField.fieldId}-${relation.type}`;
          if (key !== originalRelationKey) {
            return relation;
          }
          return {
            ...relation,
            ...nextRelation,
            isAutoGenerated: relation.isAutoGenerated,
          };
        }),
      }));
    },
    [],
  );

  const save = useCallback(async () => {
    const payload = buildRecommendRelationshipsSavePayload(editedRelations);
    if (payload.length === 0) {
      await onSaveSuccess();
      return;
    }

    try {
      setSaving(true);
      await saveSetupRelations(selector, payload);
      await onSaveSuccess();
    } catch (error) {
      const messageText =
        (error as ErrorLike)?.message || '保存关联关系失败，请稍后重试。';
      message.error(messageText);
    } finally {
      setSaving(false);
    }
  }, [editedRelations, onSaveSuccess, selector]);

  return {
    editedRelations,
    recommendNameMapping,
    requestError,
    polling,
    saving,
    task,
    modelListLoading: modelList.loading,
    hasResult,
    emptyState,
    retry,
    onDeleteRow,
    onUpdateRelation,
    save,
  };
}
