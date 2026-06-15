import { useRouter } from 'next/router';
import { useParams } from 'next/navigation';
import {
  ComponentRef,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { isEmpty } from 'lodash';
import { message } from 'antd';
import { Path } from '@/utils/enum';
import useHomeSidebar from '@/hooks/useHomeSidebar';
import SiderLayout from '@/components/layouts/SiderLayout';
import Prompt from '@/components/pages/home/prompt';
import useAskPrompt, {
  getIsFinished,
  canFetchThreadResponse,
  isRecommendedFinished,
} from '@/hooks/useAskPrompt';
import useAdjustAnswer from '@/hooks/useAdjustAnswer';
import useModalAction from '@/hooks/useModalAction';
import PromptThread from '@/components/pages/home/promptThread';
import SaveAsViewModal from '@/components/modals/SaveAsViewModal';
import QuestionSQLPairModal from '@/components/modals/QuestionSQLPairModal';
import AdjustReasoningStepsModal from '@/components/modals/AdjustReasoningStepsModal';
import AdjustSQLModal from '@/components/modals/AdjustSQLModal';
import { getAnswerIsFinished } from '@/components/pages/home/promptThread/TextBasedAnswer';
import { getIsChartFinished } from '@/components/pages/home/promptThread/ChartAnswer';
import { PromptThreadProvider } from '@/components/pages/home/promptThread/store';
import {
  useCreateThreadResponseMutation,
  useThreadQuery,
  useThreadResponseLazyQuery,
  useUpdateThreadResponseMutation,
  useGenerateThreadRecommendationQuestionsMutation,
  useGetThreadRecommendationQuestionsLazyQuery,
  useGenerateThreadResponseAnswerMutation,
  useGenerateThreadResponseChartMutation,
  useAdjustThreadResponseChartMutation,
} from '@/apollo/client/graphql/home.generated';
import { useCreateViewMutation } from '@/apollo/client/graphql/view.generated';
import {
  AdjustThreadResponseChartInput,
  CreateThreadResponseInput,
  ThreadResponse,
  CreateSqlPairInput,
} from '@/apollo/client/graphql/__types__';
import { useCreateSqlPairMutation } from '@/apollo/client/graphql/sqlPairs.generated';

const getThreadResponseIsFinished = (threadResponse: ThreadResponse) => {
  const { answerDetail, breakdownDetail, chartDetail } = threadResponse || {};
  // it means it's the old data before support text based answer
  const isBreakdownOnly = answerDetail === null && !isEmpty(breakdownDetail);

  // false make it keep polling when the text based answer is default needed.
  let isAnswerFinished = isBreakdownOnly ? null : false;
  let isChartFinished = null;

  // answerDetail status can be FAILED before getting queryId from Wren AI adapter
  if (answerDetail?.queryId || answerDetail?.status) {
    isAnswerFinished = getAnswerIsFinished(answerDetail?.status);
  }

  if (chartDetail?.queryId) {
    isChartFinished = getIsChartFinished(chartDetail?.status);
  }
  // if equal false, it means it has task & the task is not finished
  return isAnswerFinished !== false && isChartFinished !== false;
};

const THREAD_RESPONSE_POLL_INTERVAL_MS = 2000;
const THREAD_RECOMMENDATION_POLL_INTERVAL_MS = 2000;
const THREAD_RESPONSE_POLL_MAX_INTERVAL_MS = 10000;
const THREAD_RECOMMENDATION_POLL_MAX_INTERVAL_MS = 10000;

export default function HomeThread() {
  const $prompt = useRef<ComponentRef<typeof Prompt>>(null);
  const router = useRouter();
  const params = useParams();
  const homeSidebar = useHomeSidebar();
  const threadId = useMemo(() => Number(params?.id) || null, [params]);
  const askPrompt = useAskPrompt(threadId);
  const adjustAnswer = useAdjustAnswer(threadId);
  const saveAsViewModal = useModalAction();
  const questionSqlPairModal = useModalAction();
  const adjustReasoningStepsModal = useModalAction();
  const adjustSqlModal = useModalAction();

  const [showRecommendedQuestions, setShowRecommendedQuestions] =
    useState<boolean>(false);

  const [createViewMutation, { loading: creating }] = useCreateViewMutation({
    onError: (error) => console.error(error),
    onCompleted: () => message.success('Successfully created view.'),
  });

  const { data, updateQuery: updateThreadQuery } = useThreadQuery({
    variables: { threadId },
    fetchPolicy: 'network-only',
    nextFetchPolicy: 'network-only',
    skip: threadId === null,
    onError: () => router.push(Path.Home),
  });
  const [createThreadResponse] = useCreateThreadResponseMutation({
    onError: (error) => console.error(error),
    onCompleted(next) {
      const nextResponse = next.createThreadResponse;
      updateThreadQuery((prev) => {
        return {
          ...prev,
          thread: {
            ...prev.thread,
            responses: [...prev.thread.responses, nextResponse],
          },
        };
      });
    },
  });
  const [updateThreadResponse, { loading: threadResponseUpdating }] =
    useUpdateThreadResponseMutation({
      onError: (error) => console.error(error),
      onCompleted: (data) => {
        message.success('Successfully updated the SQL statement');
        // trigger generate answer after sql statement updated
        onGenerateThreadResponseAnswer(data.updateThreadResponse.id);
      },
    });
  const [fetchThreadResponse, threadResponseResult] =
    useThreadResponseLazyQuery({
      fetchPolicy: 'network-only',
      nextFetchPolicy: 'network-only',
      onCompleted(next) {
        const nextResponse = next.threadResponse;
        updateThreadQuery((prev) => ({
          ...prev,
          thread: {
            ...prev.thread,
            responses: prev.thread.responses.map((response) =>
              response.id === nextResponse.id ? nextResponse : response,
            ),
          },
        }));
      },
    });

  const [generateThreadRecommendationQuestions] =
    useGenerateThreadRecommendationQuestionsMutation({
      onError: (error) => console.error(error),
    });

  const [
    fetchThreadRecommendationQuestions,
    threadRecommendationQuestionsResult,
  ] = useGetThreadRecommendationQuestionsLazyQuery({
    fetchPolicy: 'network-only',
    nextFetchPolicy: 'network-only',
  });
  const threadResponsePollingRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const threadResponsePollingSessionRef = useRef(0);
  const threadResponsePollingTargetRef = useRef<number | null>(null);
  const threadResponsePollingRequestRef = useRef<Promise<void> | null>(null);
  const threadResponsePollingDelayRef = useRef(THREAD_RESPONSE_POLL_INTERVAL_MS);
  const lastThreadResponseFingerprintRef = useRef<string | null>(null);
  const threadRecommendationPollingRef = useRef<
    ReturnType<typeof setTimeout> | null
  >(null);
  const threadRecommendationPollingSessionRef = useRef(0);
  const threadRecommendationPollingTargetRef = useRef<number | null>(null);
  const threadRecommendationPollingRequestRef = useRef<Promise<void> | null>(
    null,
  );
  const threadRecommendationPollingDelayRef = useRef(
    THREAD_RECOMMENDATION_POLL_INTERVAL_MS,
  );
  const lastThreadRecommendationFingerprintRef = useRef<string | null>(null);

  const [generateThreadResponseAnswer] =
    useGenerateThreadResponseAnswerMutation({
      onError: (error) => console.error(error),
    });

  const [generateThreadResponseChart] = useGenerateThreadResponseChartMutation({
    onError: (error) => console.error(error),
  });
  const [adjustThreadResponseChart] = useAdjustThreadResponseChartMutation({
    onError: (error) => console.error(error),
  });

  const [createSqlPairMutation, { loading: createSqlPairLoading }] =
    useCreateSqlPairMutation({
      refetchQueries: ['SqlPairs'],
      awaitRefetchQueries: true,
      onError: (error) => console.error(error),
      onCompleted: () => {
        message.success('Successfully created question-sql pair.');
      },
    });

  const thread = useMemo(() => data?.thread || null, [data]);
  const responses = useMemo(() => thread?.responses || [], [thread]);
  const pollingResponse = useMemo(
    () => threadResponseResult.data?.threadResponse || null,
    [threadResponseResult.data],
  );
  const isPollingResponseFinished = useMemo(
    () => getThreadResponseIsFinished(pollingResponse),
    [pollingResponse],
  );

  const stopThreadResponsePolling = useCallback(() => {
    threadResponsePollingSessionRef.current += 1;
    threadResponsePollingTargetRef.current = null;
    if (threadResponsePollingRef.current) {
      clearTimeout(threadResponsePollingRef.current);
      threadResponsePollingRef.current = null;
    }
    threadResponsePollingDelayRef.current = THREAD_RESPONSE_POLL_INTERVAL_MS;
  }, []);

  const startThreadResponsePolling = useCallback(
    async (responseId?: number) => {
      if (!responseId) return;
      if (
        threadResponsePollingTargetRef.current === responseId &&
        (threadResponsePollingRequestRef.current || threadResponsePollingRef.current)
      ) {
        return;
      }

      stopThreadResponsePolling();
      threadResponsePollingTargetRef.current = responseId;
      const pollingSessionId = threadResponsePollingSessionRef.current;

      const run = async () => {
        if (threadResponsePollingSessionRef.current !== pollingSessionId) return;
        if (threadResponsePollingRequestRef.current) {
          await threadResponsePollingRequestRef.current;
          if (threadResponsePollingSessionRef.current !== pollingSessionId) {
            return;
          }
        }

        try {
          const request = fetchThreadResponse({
            variables: { responseId },
          }).then(() => undefined);
          threadResponsePollingRequestRef.current = request;
          await request;
        } catch (error) {
          console.error(error);
        } finally {
          threadResponsePollingRequestRef.current = null;
          if (threadResponsePollingSessionRef.current === pollingSessionId) {
            threadResponsePollingRef.current = setTimeout(
              run,
              threadResponsePollingDelayRef.current,
            );
          }
        }
      };

      await run();
    },
    [fetchThreadResponse, stopThreadResponsePolling],
  );

  const stopThreadRecommendationPolling = useCallback(() => {
    threadRecommendationPollingSessionRef.current += 1;
    threadRecommendationPollingTargetRef.current = null;
    if (threadRecommendationPollingRef.current) {
      clearTimeout(threadRecommendationPollingRef.current);
      threadRecommendationPollingRef.current = null;
    }
    threadRecommendationPollingDelayRef.current =
      THREAD_RECOMMENDATION_POLL_INTERVAL_MS;
  }, []);

  const startThreadRecommendationPolling = useCallback(
    async (nextThreadId?: number) => {
      if (!nextThreadId) return;
      if (
        threadRecommendationPollingTargetRef.current === nextThreadId &&
        (threadRecommendationPollingRequestRef.current ||
          threadRecommendationPollingRef.current)
      ) {
        return;
      }

      stopThreadRecommendationPolling();
      threadRecommendationPollingTargetRef.current = nextThreadId;
      const pollingSessionId = threadRecommendationPollingSessionRef.current;

      const run = async () => {
        if (
          threadRecommendationPollingSessionRef.current !== pollingSessionId
        ) {
          return;
        }
        if (threadRecommendationPollingRequestRef.current) {
          await threadRecommendationPollingRequestRef.current;
          if (
            threadRecommendationPollingSessionRef.current !== pollingSessionId
          ) {
            return;
          }
        }

        try {
          const request = fetchThreadRecommendationQuestions({
            variables: { threadId: nextThreadId },
          }).then(() => undefined);
          threadRecommendationPollingRequestRef.current = request;
          await request;
        } catch (error) {
          console.error(error);
        } finally {
          threadRecommendationPollingRequestRef.current = null;
          if (
            threadRecommendationPollingSessionRef.current === pollingSessionId
          ) {
            threadRecommendationPollingRef.current = setTimeout(
              run,
              threadRecommendationPollingDelayRef.current,
            );
          }
        }
      };

      await run();
    },
    [fetchThreadRecommendationQuestions, stopThreadRecommendationPolling],
  );

  const onFixSQLStatement = async (responseId: number, sql: string) => {
    await updateThreadResponse({
      variables: { where: { id: responseId }, data: { sql } },
    });
  };

  const onGenerateThreadResponseAnswer = async (responseId: number) => {
    if (!responseId) return;

    await generateThreadResponseAnswer({ variables: { responseId } });
    await startThreadResponsePolling(responseId);
  };

  const onGenerateThreadResponseChart = async (responseId: number) => {
    if (!responseId) return;

    await generateThreadResponseChart({ variables: { responseId } });
    await startThreadResponsePolling(responseId);
  };

  const onAdjustThreadResponseChart = async (
    responseId: number,
    data: AdjustThreadResponseChartInput,
  ) => {
    if (!responseId) return;

    await adjustThreadResponseChart({
      variables: { responseId, data },
    });
    await startThreadResponsePolling(responseId);
  };

  const onGenerateThreadRecommendedQuestions = async () => {
    if (!threadId) return;

    await generateThreadRecommendationQuestions({ variables: { threadId } });
    await startThreadRecommendationPolling(threadId);
  };

  const handleUnfinishedTasks = useCallback(
    (responses: ThreadResponse[]) => {
      // unfinished asking task
      const unfinishedAskingResponse = (responses || []).find(
        (response) =>
          response?.askingTask && !getIsFinished(response?.askingTask?.status),
      );
      const unfinishedTaskId = unfinishedAskingResponse?.askingTask?.queryId;
      if (unfinishedAskingResponse && unfinishedTaskId) {
        askPrompt.onFetching(unfinishedTaskId);
        return;
      }

      // unfinished thread response
      const unfinishedThreadResponse = (responses || []).find(
        (response) => !getThreadResponseIsFinished(response),
      );

      if (
        canFetchThreadResponse(unfinishedThreadResponse?.askingTask) &&
        unfinishedThreadResponse
      ) {
        startThreadResponsePolling(unfinishedThreadResponse.id);
      }
    },
    [askPrompt, startThreadResponsePolling],
  );

  // store thread questions for instant recommended questions
  const storeQuestionsToAskPrompt = useCallback(
    (responses: ThreadResponse[]) => {
      const questions = responses.flatMap((res) => res.question || []);
      if (questions) askPrompt.onStoreThreadQuestions(questions);
    },
    [askPrompt],
  );

  // stop all requests when change thread
  useEffect(() => {
    if (threadId !== null) {
      setShowRecommendedQuestions(true);
      void (async () => {
        try {
          const result = await fetchThreadRecommendationQuestions({
            variables: { threadId },
          });
          const status =
            result.data?.getThreadRecommendationQuestions?.status || null;
          if (status && !isRecommendedFinished(status)) {
            await startThreadRecommendationPolling(threadId);
          }
        } catch (error) {
          console.error(error);
        }
      })();
    }
    return () => {
      askPrompt.onStopPolling();
      stopThreadResponsePolling();
      stopThreadRecommendationPolling();
      $prompt.current?.close();
    };
  }, [threadId]);

  // initialize asking task
  useEffect(() => {
    if (!responses) return;
    handleUnfinishedTasks(responses);
    storeQuestionsToAskPrompt(responses);
  }, [responses]);

  useEffect(() => {
    if (isPollingResponseFinished) {
      stopThreadResponsePolling();
      setShowRecommendedQuestions(true);
    }
  }, [isPollingResponseFinished]);

  useEffect(() => {
    const fingerprint = JSON.stringify({
      id: pollingResponse?.id || null,
      askingStatus: pollingResponse?.askingTask?.status || null,
      askingType: pollingResponse?.askingTask?.type || null,
      answerStatus: pollingResponse?.answerDetail?.status || null,
      chartStatus: pollingResponse?.chartDetail?.status || null,
      breakdownStatus: pollingResponse?.breakdownDetail?.status || null,
      adjustmentStatus: pollingResponse?.adjustmentTask?.status || null,
      sql: pollingResponse?.sql || null,
    });

    if (lastThreadResponseFingerprintRef.current === fingerprint) {
      threadResponsePollingDelayRef.current = Math.min(
        threadResponsePollingDelayRef.current * 2,
        THREAD_RESPONSE_POLL_MAX_INTERVAL_MS,
      );
    } else {
      threadResponsePollingDelayRef.current = THREAD_RESPONSE_POLL_INTERVAL_MS;
      lastThreadResponseFingerprintRef.current = fingerprint;
    }
  }, [
    pollingResponse?.id,
    pollingResponse?.askingTask?.status,
    pollingResponse?.askingTask?.type,
    pollingResponse?.answerDetail?.status,
    pollingResponse?.chartDetail?.status,
    pollingResponse?.breakdownDetail?.status,
    pollingResponse?.adjustmentTask?.status,
    pollingResponse?.sql,
  ]);

  const recommendedQuestions = useMemo(
    () =>
      threadRecommendationQuestionsResult.data
        ?.getThreadRecommendationQuestions || null,
    [threadRecommendationQuestionsResult.data],
  );

  useEffect(() => {
    if (isRecommendedFinished(recommendedQuestions?.status)) {
      stopThreadRecommendationPolling();
    }
  }, [recommendedQuestions]);

  useEffect(() => {
    const fingerprint = JSON.stringify({
      status: recommendedQuestions?.status || null,
      count: recommendedQuestions?.questions?.length || 0,
      errorCode: recommendedQuestions?.error?.code || null,
    });

    if (lastThreadRecommendationFingerprintRef.current === fingerprint) {
      threadRecommendationPollingDelayRef.current = Math.min(
        threadRecommendationPollingDelayRef.current * 2,
        THREAD_RECOMMENDATION_POLL_MAX_INTERVAL_MS,
      );
    } else {
      threadRecommendationPollingDelayRef.current =
        THREAD_RECOMMENDATION_POLL_INTERVAL_MS;
      lastThreadRecommendationFingerprintRef.current = fingerprint;
    }
  }, [
    recommendedQuestions?.status,
    recommendedQuestions?.questions?.length,
    recommendedQuestions?.error?.code,
  ]);

  const onCreateResponse = async (payload: CreateThreadResponseInput) => {
    try {
      askPrompt.onStopPolling();

      const threadId = thread?.id;
      if (!threadId) return;

      await createThreadResponse({
        variables: { threadId, data: payload },
      });
      setShowRecommendedQuestions(false);
    } catch (error) {
      console.error(error);
    }
  };

  const providerValue = {
    data: thread,
    recommendedQuestions,
    showRecommendedQuestions,
    preparation: {
      askingStreamTask: askPrompt.data?.askingStreamTask,
      onStopAskingTask: askPrompt.onStop,
      onReRunAskingTask: askPrompt.onReRun,
      onStopAdjustTask: adjustAnswer.onStop,
      onReRunAdjustTask: adjustAnswer.onReRun,
      onFixSQLStatement,
      fixStatementLoading: threadResponseUpdating,
    },
    onOpenSaveAsViewModal: saveAsViewModal.openModal,
    onSelectRecommendedQuestion: onCreateResponse,
    onGenerateThreadRecommendedQuestions: onGenerateThreadRecommendedQuestions,
    onGenerateTextBasedAnswer: onGenerateThreadResponseAnswer,
    onGenerateChartAnswer: onGenerateThreadResponseChart,
    onAdjustChartAnswer: onAdjustThreadResponseChart,
    onOpenSaveToKnowledgeModal: questionSqlPairModal.openModal,
    onOpenAdjustReasoningStepsModal: adjustReasoningStepsModal.openModal,
    onOpenAdjustSQLModal: adjustSqlModal.openModal,
  };

  return (
    <SiderLayout loading={false} sidebar={homeSidebar}>
      <PromptThreadProvider value={providerValue}>
        <PromptThread />
      </PromptThreadProvider>

      <div className="py-12" />
      <Prompt
        ref={$prompt}
        {...askPrompt}
        onCreateResponse={onCreateResponse}
      />
      <SaveAsViewModal
        {...saveAsViewModal.state}
        loading={creating}
        onClose={saveAsViewModal.closeModal}
        onSubmit={async (values) => {
          await createViewMutation({
            variables: { data: values },
          });
        }}
      />
      <QuestionSQLPairModal
        {...questionSqlPairModal.state}
        onClose={questionSqlPairModal.closeModal}
        loading={createSqlPairLoading}
        onSubmit={async ({ data }: { data: CreateSqlPairInput }) => {
          await createSqlPairMutation({ variables: { data } });
        }}
      />

      <AdjustReasoningStepsModal
        {...adjustReasoningStepsModal.state}
        onClose={adjustReasoningStepsModal.closeModal}
        loading={adjustAnswer.loading}
        onSubmit={async (values) => {
          await adjustAnswer.onAdjustReasoningSteps(
            values.responseId,
            values.data,
          );
        }}
      />

      <AdjustSQLModal
        {...adjustSqlModal.state}
        onClose={adjustSqlModal.closeModal}
        loading={adjustAnswer.loading}
        onSubmit={async (values) =>
          await adjustAnswer.onAdjustSQL(values.responseId, values.sql)
        }
      />
    </SiderLayout>
  );
}
