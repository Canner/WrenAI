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
    fetchPolicy: 'cache-and-network',
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
  const threadRecommendationPollingRef = useRef<
    ReturnType<typeof setTimeout> | null
  >(null);
  const threadRecommendationPollingSessionRef = useRef(0);

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
    if (threadResponsePollingRef.current) {
      clearTimeout(threadResponsePollingRef.current);
      threadResponsePollingRef.current = null;
    }
  }, []);

  const startThreadResponsePolling = useCallback(
    async (responseId?: number) => {
      if (!responseId) return;

      stopThreadResponsePolling();
      const pollingSessionId = threadResponsePollingSessionRef.current;

      const run = async () => {
        if (threadResponsePollingSessionRef.current !== pollingSessionId) return;

        try {
          await fetchThreadResponse({
            variables: { responseId },
          });
        } catch (error) {
          console.error(error);
        } finally {
          if (threadResponsePollingSessionRef.current === pollingSessionId) {
            threadResponsePollingRef.current = setTimeout(
              run,
              THREAD_RESPONSE_POLL_INTERVAL_MS,
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
    if (threadRecommendationPollingRef.current) {
      clearTimeout(threadRecommendationPollingRef.current);
      threadRecommendationPollingRef.current = null;
    }
  }, []);

  const startThreadRecommendationPolling = useCallback(
    async (nextThreadId?: number) => {
      if (!nextThreadId) return;

      stopThreadRecommendationPolling();
      const pollingSessionId = threadRecommendationPollingSessionRef.current;

      const run = async () => {
        if (
          threadRecommendationPollingSessionRef.current !== pollingSessionId
        ) {
          return;
        }

        try {
          await fetchThreadRecommendationQuestions({
            variables: { threadId: nextThreadId },
          });
        } catch (error) {
          console.error(error);
        } finally {
          if (
            threadRecommendationPollingSessionRef.current === pollingSessionId
          ) {
            threadRecommendationPollingRef.current = setTimeout(
              run,
              THREAD_RECOMMENDATION_POLL_INTERVAL_MS,
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
      startThreadRecommendationPolling(threadId);
      setShowRecommendedQuestions(true);
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
