import { useRouter } from 'next/router';
import { useParams } from 'next/navigation';
import {
  ComponentRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
import useModalAction from '@/hooks/useModalAction';
import PromptThread from '@/components/pages/home/promptThread';
import SaveAsViewModal from '@/components/modals/SaveAsViewModal';
import QuestionSQLPairModal from '@/components/modals/QuestionSQLPairModal';
import { getAnswerIsFinished } from '@/components/pages/home/promptThread/TextBasedAnswer';
import { getIsChartFinished } from '@/components/pages/home/promptThread/ChartAnswer';
import { PromptThreadProvider } from '@/components/pages/home/promptThread/store';
import {
  useCreateThreadResponseMutation,
  useThreadQuery,
  useThreadResponseLazyQuery,
  useGenerateThreadRecommendationQuestionsMutation,
  useGetThreadRecommendationQuestionsLazyQuery,
  useGenerateThreadResponseAnswerMutation,
  useGenerateThreadResponseBreakdownMutation,
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
  let isBreakdownFinished = null;
  let isChartFinished = null;

  // answerDetail status can be FAILED before getting queryId from Wren AI adapter
  if (answerDetail?.queryId || answerDetail?.status) {
    isAnswerFinished = getAnswerIsFinished(answerDetail?.status);
  }
  if (breakdownDetail?.queryId) {
    isBreakdownFinished = getIsFinished(breakdownDetail?.status);
  }
  if (chartDetail?.queryId) {
    isChartFinished = getIsChartFinished(chartDetail?.status);
  }
  // if equal false, it means it has task & the task is not finished
  return (
    isAnswerFinished !== false &&
    isBreakdownFinished !== false &&
    isChartFinished !== false
  );
};

export default function HomeThread() {
  const $prompt = useRef<ComponentRef<typeof Prompt>>(null);
  const router = useRouter();
  const params = useParams();
  const homeSidebar = useHomeSidebar();
  const threadId = useMemo(() => Number(params?.id) || null, [params]);
  const askPrompt = useAskPrompt(threadId);
  const saveAsViewModal = useModalAction();
  const questionSqlPairModal = useModalAction();

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
  const [fetchThreadResponse, threadResponseResult] =
    useThreadResponseLazyQuery({
      pollInterval: 1000,
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
    useGenerateThreadRecommendationQuestionsMutation();

  const [
    fetchThreadRecommendationQuestions,
    threadRecommendationQuestionsResult,
  ] = useGetThreadRecommendationQuestionsLazyQuery({
    pollInterval: 1000,
  });

  const [generateThreadResponseAnswer] =
    useGenerateThreadResponseAnswerMutation();

  const [generateThreadResponseBreakdown] =
    useGenerateThreadResponseBreakdownMutation();

  const [generateThreadResponseChart] =
    useGenerateThreadResponseChartMutation();
  const [adjustThreadResponseChart] = useAdjustThreadResponseChartMutation();

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

  const onGenerateThreadResponseAnswer = async (responseId: number) => {
    await generateThreadResponseAnswer({ variables: { responseId } });
    fetchThreadResponse({ variables: { responseId } });
  };

  const onGenerateThreadResponseBreakdown = async (responseId: number) => {
    await generateThreadResponseBreakdown({
      variables: { responseId },
    });
    fetchThreadResponse({ variables: { responseId } });
  };

  const onGenerateThreadResponseChart = async (responseId: number) => {
    await generateThreadResponseChart({ variables: { responseId } });
    fetchThreadResponse({ variables: { responseId } });
  };

  const onAdjustThreadResponseChart = async (
    responseId: number,
    data: AdjustThreadResponseChartInput,
  ) => {
    await adjustThreadResponseChart({
      variables: { responseId, data },
    });
    fetchThreadResponse({ variables: { responseId } });
  };

  const onGenerateThreadRecommendedQuestions = async () => {
    await generateThreadRecommendationQuestions({ variables: { threadId } });
    fetchThreadRecommendationQuestions({ variables: { threadId } });
  };

  const handleUnfinishedTasks = useCallback(
    (responses: ThreadResponse[]) => {
      // unfinished asking task
      const unfinishedAskingResponse = (responses || []).find(
        (response) =>
          response?.askingTask && !getIsFinished(response?.askingTask?.status),
      );
      if (unfinishedAskingResponse) {
        askPrompt.onFetching(unfinishedAskingResponse?.askingTask?.queryId);
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
        fetchThreadResponse({
          variables: { responseId: unfinishedThreadResponse.id },
        });
      }
    },
    [askPrompt, fetchThreadResponse],
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
      fetchThreadRecommendationQuestions({ variables: { threadId } });
      setShowRecommendedQuestions(true);
    }
    return () => {
      askPrompt.onStopPolling();
      threadResponseResult.stopPolling();
      threadRecommendationQuestionsResult.stopPolling();
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
      threadResponseResult.stopPolling();
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
      threadRecommendationQuestionsResult.stopPolling();
    }
  }, [recommendedQuestions]);

  const onCreateResponse = async (payload: CreateThreadResponseInput) => {
    try {
      askPrompt.onStopPolling();

      const threadId = thread.id;
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
    },
    onOpenSaveAsViewModal: saveAsViewModal.openModal,
    onSelectRecommendedQuestion: onCreateResponse,
    onGenerateThreadRecommendedQuestions: onGenerateThreadRecommendedQuestions,
    onGenerateTextBasedAnswer: onGenerateThreadResponseAnswer,
    onGenerateBreakdownAnswer: onGenerateThreadResponseBreakdown,
    onGenerateChartAnswer: onGenerateThreadResponseChart,
    onAdjustChartAnswer: onAdjustThreadResponseChart,
    onOpenSaveToKnowledgeModal: questionSqlPairModal.openModal,
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
    </SiderLayout>
  );
}
