import { useCallback, useMemo, useState } from 'react';
import { appMessage as message } from '@/utils/antdAppBridge';
import useModelList from '@/hooks/useModelList';
import usePollingRequestLoop from '@/hooks/usePollingRequestLoop';
import {
  createSemanticsDescriptionTask,
  fetchSemanticsDescriptionTask,
  updateModelMetadata,
} from '@/utils/modelingRest';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import type { SemanticsDescriptionTaskResponse } from '@/types/modelingAssistant';
import { buildSemanticsDescriptionSavePayload } from './recommendSemanticsSupport';

type ErrorLike = {
  message?: string | null;
};

export type RecommendSemanticsStep = 'pick' | 'generate';

const DEFAULT_PROMPT = '';

const EXAMPLE_PROMPTS = ['College', 'E-commerce', 'Human Resources'] as const;

export default function useRecommendSemanticsWizard({
  enabled,
  selector,
  onSaveSuccess,
}: {
  enabled: boolean;
  selector: ClientRuntimeScopeSelector;
  onSaveSuccess: () => void | Promise<void>;
}) {
  const modelList = useModelList({ enabled });
  const [step, setStep] = useState<RecommendSemanticsStep>('pick');
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [task, setTask] = useState<SemanticsDescriptionTaskResponse | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const {
    startPolling,
    stopPolling,
    loading: polling,
  } = usePollingRequestLoop<SemanticsDescriptionTaskResponse>({
    shouldContinue: (nextTask) => nextTask.status === 'GENERATING',
    onCompleted: (nextTask) => {
      setTask(nextTask);
      if (nextTask.status === 'FAILED') {
        setRequestError(
          nextTask.error?.message || '生成语义描述失败，请稍后重试。',
        );
      }
    },
    onError: (error) => {
      setRequestError(error.message);
    },
  });

  const generatedModels = useMemo(() => task?.response || [], [task]);

  const completed = task?.status === 'FINISHED' && generatedModels.length > 0;

  const onToggleModel = useCallback((modelName: string, checked: boolean) => {
    setValidationError(null);
    setSaveError(null);
    setSelectedModels((current) =>
      checked
        ? [...new Set([...current, modelName])]
        : current.filter((item) => item !== modelName),
    );
  }, []);

  const onNext = useCallback(() => {
    if (selectedModels.length === 0) {
      setValidationError('Please select at least one model.');
      return;
    }

    setValidationError(null);
    setSaveError(null);
    setStep('generate');
  }, [selectedModels.length]);

  const onBack = useCallback(() => {
    stopPolling();
    setSelectedModels([]);
    setTask(null);
    setRequestError(null);
    setSaveError(null);
    setStep('pick');
  }, [stopPolling]);

  const generate = useCallback(async () => {
    try {
      setRequestError(null);
      setSaveError(null);
      const nextTask = await createSemanticsDescriptionTask(selector, {
        selectedModels,
        userPrompt: prompt,
      });
      setTask({
        id: nextTask.id,
        status: 'GENERATING',
        response: null,
        error: null,
      });
      await startPolling(() =>
        fetchSemanticsDescriptionTask(selector, nextTask.id),
      );
    } catch (error) {
      const messageText =
        (error as ErrorLike)?.message || '生成语义描述失败，请稍后重试。';
      setRequestError(messageText);
    }
  }, [prompt, selectedModels, selector, startPolling]);

  const save = useCallback(async () => {
    if (!modelList.data || generatedModels.length === 0) {
      return;
    }

    try {
      setSaving(true);
      setSaveError(null);
      const payload = buildSemanticsDescriptionSavePayload({
        generatedModels,
        models: modelList.data,
      });
      await Promise.all(
        payload.map((item) =>
          updateModelMetadata(selector, item.modelId, item.data),
        ),
      );
      message.success('Semantics saved successfully.');
      await onSaveSuccess();
    } catch (error) {
      const messageText =
        (error as ErrorLike)?.message || '保存语义描述失败，请稍后重试。';
      setSaveError(messageText);
    } finally {
      setSaving(false);
    }
  }, [generatedModels, modelList.data, onSaveSuccess, selector]);

  const retryGenerate = useCallback(async () => {
    stopPolling();
    setTask(null);
    await generate();
  }, [generate, stopPolling]);

  return {
    step,
    selectedModels,
    prompt,
    setPrompt,
    validationError,
    requestError,
    saveError,
    modelList,
    polling,
    saving,
    task,
    generatedModels,
    completed,
    examplePrompts: EXAMPLE_PROMPTS,
    onToggleModel,
    onNext,
    onBack,
    generate,
    retryGenerate,
    save,
  };
}
