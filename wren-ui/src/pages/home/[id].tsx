import { useRouter } from 'next/router';
import {
  ComponentRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { isEmpty } from 'lodash';
import { Typography, message } from 'antd';
import BookOutlined from '@ant-design/icons/BookOutlined';
import { Path } from '@/utils/enum';
import styled from 'styled-components';
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
import {
  IPromptThreadStore,
  PromptThreadProvider,
} from '@/components/pages/home/promptThread/store';
import ConsoleShellLayout from '@/components/reference/ConsoleShellLayout';
import {
  adjustThreadResponseChart as adjustThreadResponseChartRequest,
  createThreadResponse as createThreadResponseRequest,
  triggerThreadRecommendationQuestions as triggerThreadRecommendationQuestionsRequest,
  triggerThreadResponseAnswer as triggerThreadResponseAnswerRequest,
  triggerThreadResponseChart as triggerThreadResponseChartRequest,
  updateThreadResponseSql as updateThreadResponseSqlRequest,
} from '@/utils/threadRest';
import { createViewFromResponse } from '@/utils/viewRest';
import {
  AdjustThreadResponseChartInput,
  CreateThreadResponseInput,
  DetailedThread,
  ThreadResponse,
  CreateSqlPairInput,
} from '@/apollo/client/graphql/__types__';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeSelectorState from '@/hooks/useRuntimeSelectorState';
import { buildNovaShellNavItems } from '@/components/reference/novaShellNavigation';
import { getReferenceDisplayKnowledgeName } from '@/utils/referenceDemoKnowledge';
import {
  HISTORICAL_SNAPSHOT_READONLY_HINT,
  hasLatestExecutableSnapshot,
  isHistoricalSnapshotReadonly,
} from '@/utils/runtimeSnapshot';
import { createKnowledgeSqlPair } from '@/utils/knowledgeRuleSqlRest';
import useThreadDetail from '@/hooks/useThreadDetail';
import useThreadResponsePolling from '@/hooks/useThreadResponsePolling';
import useThreadRecommendedQuestionsPolling from '@/hooks/useThreadRecommendedQuestionsPolling';

const getThreadResponseIsFinished = (
  threadResponse?: ThreadResponseData | null,
) => {
  const { answerDetail, breakdownDetail, chartDetail } = threadResponse || {};
  const hasSqlResult =
    typeof threadResponse?.sql === 'string' && threadResponse.sql.trim() !== '';
  const hasAnswerTask = Boolean(answerDetail?.queryId || answerDetail?.status);
  const hasChartTask = Boolean(chartDetail?.queryId || chartDetail?.status);

  // it means it's the old data before support text based answer
  const isBreakdownOnly = answerDetail === null && !isEmpty(breakdownDetail);

  // SQL-only responses are already renderable and should not keep polling.
  if (hasSqlResult && !hasAnswerTask && !hasChartTask) {
    return true;
  }

  // false make it keep polling when the text based answer is default needed.
  let isAnswerFinished = isBreakdownOnly ? null : false;
  let isChartFinished = null;

  // answerDetail status can be FAILED before getting queryId from Wren AI adapter
  if (hasAnswerTask) {
    isAnswerFinished = getAnswerIsFinished(answerDetail?.status);
  }

  if (hasChartTask) {
    isChartFinished = getIsChartFinished(chartDetail?.status);
  }
  // if equal false, it means it has task & the task is not finished
  return isAnswerFinished !== false && isChartFinished !== false;
};

const hasReferenceRenderableResponse = (
  threadResponse: ThreadResponseData | null,
) =>
  Boolean(
    threadResponse?.answerDetail?.content ||
      threadResponse?.chartDetail?.chartSchema ||
      threadResponse?.sql,
  );

const REFERENCE_FOLLOW_UPS = [
  '从折线图中移除离群值',
  '为折线图添加标签',
  '将标题重新命名为“单位成本趋势”',
  '推荐几个问题给我',
];
const REFERENCE_PRIMARY_QUESTION = '每个供应商单产品的成本趋势';
const THREAD_RESPONSE_POLL_INTERVAL_MS = 1500;
const THREAD_RESPONSE_POLL_TIMEOUT_MS = 45_000;
const THREAD_RECOMMEND_POLL_INTERVAL_MS = 1500;
const THREAD_RECOMMEND_POLL_TIMEOUT_MS = 20_000;

const buildThreadQuestionSignature = (responses: ThreadResponseData[]) => {
  const latestResponse = responses[responses.length - 1];
  const latestQuestion = latestResponse?.question || '';

  return `${responses.length}:${latestResponse?.id || 'none'}:${latestQuestion}`;
};

const { Text } = Typography;

type ThreadData = DetailedThread;
type ThreadResponseData = ThreadData['responses'][number];

export const findLatestUnfinishedAskingResponse = (
  responses: ThreadResponseData[],
) =>
  [...(responses || [])]
    .reverse()
    .find(
      (response) =>
        response?.askingTask && !getIsFinished(response?.askingTask?.status),
    );

export const findLatestPollableThreadResponse = (
  responses: ThreadResponseData[],
) =>
  [...(responses || [])]
    .reverse()
    .find(
      (response) =>
        !getThreadResponseIsFinished(response) &&
        canFetchThreadResponse(response?.askingTask),
    );

const reportThreadError = (_error: unknown, fallbackMessage: string) => {
  message.error(fallbackMessage);
};

const ThreadScene = styled.div`
  width: min(100%, 880px);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 72px);
  gap: 12px;
  padding: 4px 0 20px;
`;

const ConversationPane = styled.section`
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: transparent;
`;

const ConversationBody = styled.div`
  flex: 1;
  width: 100%;
  min-height: 0;
  overflow: auto;
  padding: 0 0 20px;
`;

const ComposerSelectedScopeRow = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
`;

const ComposerSelectedKnowledgeChip = styled.div`
  height: 28px;
  border-radius: 8px;
  background: #ffffff;
  color: #4b5563;
  border: 1px solid #e5e7eb;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
`;

const ComposerDock = styled.div`
  padding: 0;
  background: transparent;
`;

const ComposerFrame = styled.div`
  border-radius: 18px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.98);
  box-shadow: none;
  padding: 12px 14px 10px;
`;

const ComposerAssistRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 0 2px 10px;
`;

const ComposerHintText = styled(Text)`
  &.ant-typography {
    margin-bottom: 0;
    color: #8b93a3;
    font-size: 12px;
  }
`;

const ReferenceConversation = styled.div`
  padding: 22px 8px 36px 8px;
  display: flex;
  flex-direction: column;
  gap: 18px;
`;

const SpeakerRow = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 12px;
`;

const SpeakerBadge = styled.div<{ $tone: 'user' | 'assistant' }>`
  width: 34px;
  height: 34px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  color: ${(props) => (props.$tone === 'user' ? '#fff' : '#5a6174')};
  background: ${(props) =>
    props.$tone === 'user' ? '#db6b54' : 'rgba(15, 23, 42, 0.06)'};
`;

const Bubble = styled.div<{ $muted?: boolean }>`
  flex: 1;
  border-radius: 18px;
  border: 1px solid rgba(15, 23, 42, 0.06);
  background: ${(props) =>
    props.$muted ? 'rgba(251, 252, 255, 0.9)' : 'rgba(255, 255, 255, 0.96)'};
  padding: 16px 18px;
  box-shadow: 0 16px 28px rgba(15, 23, 42, 0.04);
`;

const StatusLine = styled.div`
  color: #3d4353;
  font-size: 15px;
  font-weight: 600;
`;

const ThinkingLine = styled.div`
  width: fit-content;
  color: #4f5668;
  font-size: 14px;
  font-weight: 600;
`;

const InsightBlock = styled.div`
  padding-left: 46px;
  color: #2b3140;
  line-height: 1.7;
  font-size: 14px;
`;

const InlinePreviewCard = styled.div`
  margin-left: 46px;
  border-radius: 16px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.96);
  padding: 14px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  box-shadow: 0 16px 28px rgba(15, 23, 42, 0.04);
`;

const InlineCardMeta = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const SubtleBadge = styled.span`
  min-height: 30px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.06);
  color: #4a5263;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
`;

const SuggestionShell = styled.div`
  margin-top: 4px;
  border-radius: 20px;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: rgba(255, 255, 255, 0.96);
  padding: 16px;
  box-shadow: 0 18px 28px rgba(15, 23, 42, 0.04);
`;

const SuggestionChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 10px;
`;

const SuggestionChip = styled.button`
  border: 1px solid rgba(15, 23, 42, 0.1);
  background: #fff;
  color: #3f4657;
  border-radius: 10px;
  height: 34px;
  padding: 0 12px;
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease;

  &:hover {
    border-color: rgba(141, 101, 225, 0.22);
    color: var(--nova-primary-strong);
    transform: translateY(-1px);
  }
`;

export default function HomeThread() {
  const $prompt = useRef<ComponentRef<typeof Prompt>>(null);
  const router = useRouter();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const storedQuestionsSignatureRef = useRef<string | null>(null);
  const pollingAskingTaskIdRef = useRef<string | null>(null);
  const pollingResponseIdRef = useRef<number | null>(null);
  const threadResponseRequestInFlightRef = useRef<number | null>(null);
  const threadRecommendRequestInFlightRef = useRef(false);
  const threadResponsePollingTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const threadRecommendPollingTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const cleanupThreadRef = useRef<() => void>(() => {});
  const threadId = useMemo(() => {
    const routeId = Number(router.query.id as string);
    if (routeId) {
      return routeId;
    }

    const browserPath =
      typeof window !== 'undefined' ? window.location.pathname : '';
    const matchedId = `${router.asPath} ${browserPath}`.match(
      /\/home\/(\d+)/,
    )?.[1];
    return matchedId ? Number(matchedId) : null;
  }, [router.asPath, router.query.id]);
  const saveAsViewModal = useModalAction();
  const questionSqlPairModal = useModalAction();
  const adjustReasoningStepsModal = useModalAction();
  const adjustSqlModal = useModalAction();
  const runtimeSelector = useRuntimeSelectorState();
  const runtimeSelectorState = runtimeSelector.runtimeSelectorState;
  const selectorHasRuntime = Boolean(
    runtimeScopeNavigation.selector.deployHash ||
      runtimeScopeNavigation.selector.kbSnapshotId ||
      runtimeScopeNavigation.selector.runtimeScopeId ||
      runtimeSelectorState?.currentKbSnapshot?.deployHash ||
      runtimeSelectorState?.currentKbSnapshot?.id,
  );
  const hasExecutableRuntime = useMemo(() => {
    return hasLatestExecutableSnapshot({
      selectorHasRuntime,
      currentKbSnapshotId: runtimeSelectorState?.currentKbSnapshot?.id,
      defaultKbSnapshotId:
        runtimeSelectorState?.currentKnowledgeBase?.defaultKbSnapshotId,
    });
  }, [runtimeSelectorState, selectorHasRuntime]);
  const isHistoricalRuntimeReadonly = useMemo(() => {
    return isHistoricalSnapshotReadonly({
      selectorHasRuntime,
      currentKbSnapshotId: runtimeSelectorState?.currentKbSnapshot?.id,
      defaultKbSnapshotId:
        runtimeSelectorState?.currentKnowledgeBase?.defaultKbSnapshotId,
    });
  }, [runtimeSelectorState, selectorHasRuntime]);

  const [showRecommendedQuestions, setShowRecommendedQuestions] =
    useState<boolean>(false);
  const [creating, setCreating] = useState(false);

  const {
    data,
    loading: threadLoading,
    updateQuery: updateThreadQuery,
  } = useThreadDetail({
    threadId,
    enabled: runtimeScopePage.hasRuntimeScope,
    runtimeScopeSelector: runtimeScopeNavigation.selector,
    onError: (error) => {
      reportThreadError(error, '加载对话失败，已返回首页');
      runtimeScopeNavigation.pushWorkspace(Path.Home);
    },
  });
  const askPrompt = useAskPrompt(
    threadId ?? undefined,
    undefined,
    updateThreadQuery,
  );
  const adjustAnswer = useAdjustAnswer(
    threadId ?? undefined,
    updateThreadQuery,
    runtimeScopeNavigation.selector,
  );
  const [threadResponseUpdating, setThreadResponseUpdating] = useState(false);
  const upsertThreadResponse = useCallback(
    (nextResponse: ThreadResponse) => {
      updateThreadQuery((prev) => {
        const hasMatchedResponse = prev.thread.responses.some(
          (response) => response.id === nextResponse.id,
        );

        return {
          ...prev,
          thread: {
            ...prev.thread,
            responses: hasMatchedResponse
              ? prev.thread.responses.map((response) =>
                  response.id === nextResponse.id ? nextResponse : response,
                )
              : [...prev.thread.responses, nextResponse],
          },
        };
      });
    },
    [updateThreadQuery],
  );
  const {
    data: pollingResponse,
    fetchById: fetchThreadResponse,
    stopPolling: stopThreadResponseHookPolling,
  } = useThreadResponsePolling({
    runtimeScopeSelector: runtimeScopeNavigation.selector,
    pollInterval: THREAD_RESPONSE_POLL_INTERVAL_MS,
    onCompleted(nextResponse) {
      upsertThreadResponse(nextResponse);
    },
    onError: (error) => {
      reportThreadError(error, '加载对话结果失败，请稍后重试');
    },
  });

  const {
    data: recommendedQuestions,
    fetchByThreadId: fetchThreadRecommendationQuestions,
    stopPolling: stopThreadRecommendationQuestionsHookPolling,
  } = useThreadRecommendedQuestionsPolling({
    runtimeScopeSelector: runtimeScopeNavigation.selector,
    pollInterval: THREAD_RECOMMEND_POLL_INTERVAL_MS,
    onError: (error) => {
      reportThreadError(error, '加载推荐追问失败，请稍后重试');
    },
  });

  const [createSqlPairLoading, setCreateSqlPairLoading] = useState(false);
  const handleCreateView = useCallback(
    async (data: {
      name: string;
      rephrasedQuestion: string;
      responseId: number;
    }) => {
      setCreating(true);
      try {
        await createViewFromResponse(runtimeScopeNavigation.selector, data);
        message.success('视图已创建。');
      } catch (error) {
        reportThreadError(error, '创建视图失败，请稍后重试');
        throw error;
      } finally {
        setCreating(false);
      }
    },
    [runtimeScopeNavigation.selector],
  );

  const handleCreateSqlPair = useCallback(
    async (data: CreateSqlPairInput) => {
      setCreateSqlPairLoading(true);
      try {
        await createKnowledgeSqlPair(runtimeScopeNavigation.selector, data);
        message.success('SQL 模板已创建。');
      } catch (error) {
        reportThreadError(error, '保存 SQL 模板失败，请稍后重试');
        throw error;
      } finally {
        setCreateSqlPairLoading(false);
      }
    },
    [runtimeScopeNavigation.selector],
  );

  const thread = useMemo(() => data?.thread || null, [data]);
  const responses = useMemo(() => thread?.responses || [], [thread]);
  const runtimeKnowledgeBases = runtimeSelectorState?.knowledgeBases || [];
  const routeKnowledgeBaseIds = useMemo(() => {
    const rawKnowledgeBaseIds = router.query.knowledgeBaseIds;
    const joinedKnowledgeBaseIds = Array.isArray(rawKnowledgeBaseIds)
      ? rawKnowledgeBaseIds[0]
      : rawKnowledgeBaseIds;

    if (!joinedKnowledgeBaseIds) {
      return [];
    }

    return `${joinedKnowledgeBaseIds}`
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }, [router.query.knowledgeBaseIds]);
  const selectedKnowledgeBaseNames = useMemo(() => {
    const threadKnowledgeBaseIds = thread?.knowledgeBaseIds || [];
    const scopedKnowledgeBaseIds =
      threadKnowledgeBaseIds.length > 0
        ? threadKnowledgeBaseIds
        : routeKnowledgeBaseIds.length > 0
          ? routeKnowledgeBaseIds
          : thread?.knowledgeBaseId
            ? [thread.knowledgeBaseId]
            : [];

    if (scopedKnowledgeBaseIds.length === 0) {
      return [];
    }

    return scopedKnowledgeBaseIds.map((knowledgeBaseId: string) => {
      const matchedKnowledgeBase = runtimeKnowledgeBases.find(
        (item) => item.id === knowledgeBaseId,
      );

      return getReferenceDisplayKnowledgeName(
        matchedKnowledgeBase?.name || knowledgeBaseId,
      );
    });
  }, [routeKnowledgeBaseIds, runtimeKnowledgeBases, thread]);
  const isPollingResponseFinished = useMemo(
    () =>
      pollingResponse ? getThreadResponseIsFinished(pollingResponse) : false,
    [pollingResponse],
  );

  const clearThreadResponsePollingTimeout = useCallback(() => {
    if (threadResponsePollingTimeoutRef.current) {
      clearTimeout(threadResponsePollingTimeoutRef.current);
      threadResponsePollingTimeoutRef.current = null;
    }
  }, []);

  const clearThreadRecommendPollingTimeout = useCallback(() => {
    if (threadRecommendPollingTimeoutRef.current) {
      clearTimeout(threadRecommendPollingTimeoutRef.current);
      threadRecommendPollingTimeoutRef.current = null;
    }
  }, []);

  const scheduleThreadResponsePollingStop = useCallback(() => {
    clearThreadResponsePollingTimeout();
    threadResponsePollingTimeoutRef.current = setTimeout(() => {
      stopThreadResponseHookPolling();
      message.warning('对话结果轮询超时，请稍后重试');
    }, THREAD_RESPONSE_POLL_TIMEOUT_MS);
  }, [clearThreadResponsePollingTimeout, stopThreadResponseHookPolling]);

  const scheduleThreadRecommendPollingStop = useCallback(() => {
    clearThreadRecommendPollingTimeout();
    threadRecommendPollingTimeoutRef.current = setTimeout(() => {
      stopThreadRecommendationQuestionsHookPolling();
    }, THREAD_RECOMMEND_POLL_TIMEOUT_MS);
  }, [
    clearThreadRecommendPollingTimeout,
    stopThreadRecommendationQuestionsHookPolling,
  ]);

  const stopThreadResponsePolling = useCallback(() => {
    stopThreadResponseHookPolling();
    clearThreadResponsePollingTimeout();
  }, [clearThreadResponsePollingTimeout, stopThreadResponseHookPolling]);

  const stopThreadRecommendPolling = useCallback(() => {
    stopThreadRecommendationQuestionsHookPolling();
    clearThreadRecommendPollingTimeout();
  }, [
    clearThreadRecommendPollingTimeout,
    stopThreadRecommendationQuestionsHookPolling,
  ]);

  const startThreadResponsePolling = useCallback(
    (responseId: number) => {
      if (
        pollingResponseIdRef.current === responseId ||
        threadResponseRequestInFlightRef.current === responseId
      ) {
        scheduleThreadResponsePollingStop();
        return;
      }

      pollingResponseIdRef.current = responseId;
      threadResponseRequestInFlightRef.current = responseId;
      stopThreadResponsePolling();
      void fetchThreadResponse(responseId).finally(() => {
        if (threadResponseRequestInFlightRef.current === responseId) {
          threadResponseRequestInFlightRef.current = null;
        }
        scheduleThreadResponsePollingStop();
      });
    },
    [
      fetchThreadResponse,
      scheduleThreadResponsePollingStop,
      stopThreadResponsePolling,
      threadResponseRequestInFlightRef,
    ],
  );

  const onGenerateThreadResponseAnswer = useCallback(
    async (responseId: number) => {
      try {
        const nextResponse = await triggerThreadResponseAnswerRequest(
          runtimeScopeNavigation.selector,
          responseId,
        );
        upsertThreadResponse(nextResponse);
        startThreadResponsePolling(responseId);
      } catch (error) {
        reportThreadError(error, '生成回答失败，请稍后重试');
      }
    },
    [
      runtimeScopeNavigation.selector,
      startThreadResponsePolling,
      upsertThreadResponse,
    ],
  );

  const onGenerateThreadResponseChart = useCallback(
    async (responseId: number) => {
      try {
        const nextResponse = await triggerThreadResponseChartRequest(
          runtimeScopeNavigation.selector,
          responseId,
        );
        upsertThreadResponse(nextResponse);
        startThreadResponsePolling(responseId);
      } catch (error) {
        reportThreadError(error, '生成图表失败，请稍后重试');
      }
    },
    [
      runtimeScopeNavigation.selector,
      startThreadResponsePolling,
      upsertThreadResponse,
    ],
  );

  const onAdjustThreadResponseChart = useCallback(
    async (responseId: number, data: AdjustThreadResponseChartInput) => {
      try {
        const nextResponse = await adjustThreadResponseChartRequest(
          runtimeScopeNavigation.selector,
          responseId,
          data,
        );
        upsertThreadResponse(nextResponse);
      } catch (error) {
        reportThreadError(error, '调整图表失败，请稍后重试');
      }
    },
    [runtimeScopeNavigation.selector, upsertThreadResponse],
  );

  const onFixSQLStatement = useCallback(
    async (responseId: number, sql: string) => {
      setThreadResponseUpdating(true);
      try {
        const nextResponse = await updateThreadResponseSqlRequest(
          runtimeScopeNavigation.selector,
          responseId,
          { sql },
        );
        upsertThreadResponse(nextResponse);
        message.success('SQL 语句已更新。');
        await onGenerateThreadResponseAnswer(nextResponse.id);
      } catch (error) {
        reportThreadError(error, '更新 SQL 失败，请稍后重试');
      } finally {
        setThreadResponseUpdating(false);
      }
    },
    [
      onGenerateThreadResponseAnswer,
      runtimeScopeNavigation.selector,
      upsertThreadResponse,
    ],
  );

  const onGenerateThreadRecommendedQuestions = useCallback(async () => {
    const currentThreadId = thread?.id ?? threadId;
    if (!currentThreadId) {
      message.error('当前对话尚未就绪，请稍后再试');
      return;
    }
    if (threadRecommendRequestInFlightRef.current) {
      return;
    }

    threadRecommendRequestInFlightRef.current = true;
    setShowRecommendedQuestions(true);
    stopThreadRecommendPolling();
    try {
      await triggerThreadRecommendationQuestionsRequest(
        runtimeScopeNavigation.selector,
        currentThreadId,
      );
      void fetchThreadRecommendationQuestions(currentThreadId).finally(() => {
        scheduleThreadRecommendPollingStop();
        threadRecommendRequestInFlightRef.current = false;
      });
    } catch (error) {
      threadRecommendRequestInFlightRef.current = false;
      reportThreadError(error, '生成推荐追问失败，请稍后重试');
    }
  }, [
    fetchThreadRecommendationQuestions,
    runtimeScopeNavigation.selector,
    scheduleThreadRecommendPollingStop,
    stopThreadRecommendPolling,
    thread?.id,
    threadId,
  ]);

  const handleUnfinishedTasks = useCallback(
    (responses: ThreadResponse[]) => {
      // unfinished asking task
      const unfinishedAskingResponse =
        findLatestUnfinishedAskingResponse(responses);
      if (unfinishedAskingResponse) {
        const queryId = unfinishedAskingResponse?.askingTask?.queryId;
        if (!queryId || pollingAskingTaskIdRef.current === queryId) {
          return;
        }

        pollingAskingTaskIdRef.current = queryId;
        pollingResponseIdRef.current = null;
        askPrompt.onFetching(queryId);
        return;
      }

      // unfinished thread response
      const unfinishedThreadResponse =
        findLatestPollableThreadResponse(responses);

      if (unfinishedThreadResponse) {
        askPrompt.onStopPolling();
        pollingAskingTaskIdRef.current = null;
        if (pollingResponseIdRef.current === unfinishedThreadResponse.id) {
          return;
        }

        startThreadResponsePolling(unfinishedThreadResponse.id);
        return;
      }

      askPrompt.onStopPolling();
      stopThreadResponsePolling();
      pollingAskingTaskIdRef.current = null;
      pollingResponseIdRef.current = null;
      threadResponseRequestInFlightRef.current = null;
    },
    [askPrompt, startThreadResponsePolling, stopThreadResponsePolling],
  );

  // store thread questions for instant recommended questions
  const storeQuestionsToAskPrompt = useCallback(
    (responses: ThreadResponseData[]) => {
      const questions = responses.flatMap((res) => res.question || []);
      if (questions) askPrompt.onStoreThreadQuestions(questions);
    },
    [askPrompt],
  );

  useEffect(() => {
    cleanupThreadRef.current = () => {
      askPrompt.onStopPolling();
      askPrompt.onStopStreaming();
      askPrompt.onStopRecommend();
      stopThreadResponsePolling();
      stopThreadRecommendPolling();
      pollingAskingTaskIdRef.current = null;
      pollingResponseIdRef.current = null;
      threadResponseRequestInFlightRef.current = null;
      threadRecommendRequestInFlightRef.current = false;
      $prompt.current?.close();
    };
  }, [askPrompt, stopThreadRecommendPolling, stopThreadResponsePolling]);

  // stop all requests when change thread
  useEffect(() => {
    return () => {
      cleanupThreadRef.current();
    };
  }, [threadId]);

  // initialize asking task
  useEffect(() => {
    if (!responses) return;
    if (hasExecutableRuntime) {
      handleUnfinishedTasks(responses);
    }
    const nextQuestionsSignature = buildThreadQuestionSignature(responses);
    if (storedQuestionsSignatureRef.current !== nextQuestionsSignature) {
      storedQuestionsSignatureRef.current = nextQuestionsSignature;
      storeQuestionsToAskPrompt(responses);
    }
  }, [
    handleUnfinishedTasks,
    hasExecutableRuntime,
    responses,
    storeQuestionsToAskPrompt,
  ]);

  useEffect(() => {
    if (pollingResponseIdRef.current !== null && isPollingResponseFinished) {
      stopThreadResponsePolling();
      pollingResponseIdRef.current = null;
      threadResponseRequestInFlightRef.current = null;
      setShowRecommendedQuestions(true);
    }
  }, [isPollingResponseFinished, stopThreadResponsePolling]);

  useEffect(() => {
    if (isRecommendedFinished(recommendedQuestions?.status)) {
      stopThreadRecommendPolling();
      threadRecommendRequestInFlightRef.current = false;
    }
  }, [recommendedQuestions, stopThreadRecommendPolling]);

  const onCreateResponse = useCallback(
    async (payload: CreateThreadResponseInput) => {
      try {
        askPrompt.onStopPolling();

        const currentThreadId = thread?.id;
        if (!currentThreadId) {
          message.error('当前对话尚未就绪，请稍后再试');
          return;
        }
        const nextResponse = await createThreadResponseRequest(
          runtimeScopeNavigation.selector,
          currentThreadId,
          payload,
        );
        upsertThreadResponse(nextResponse);
        setShowRecommendedQuestions(false);
      } catch (error) {
        reportThreadError(error, '创建回答失败，请稍后重试');
      }
    },
    [
      askPrompt,
      runtimeScopeNavigation.selector,
      thread?.id,
      upsertThreadResponse,
    ],
  );

  const providerValue = useMemo<IPromptThreadStore | null>(() => {
    if (!thread) {
      return null;
    }

    return {
      data: thread as IPromptThreadStore['data'],
      recommendedQuestions:
        (recommendedQuestions as IPromptThreadStore['recommendedQuestions']) ||
        null,
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
      onGenerateThreadRecommendedQuestions,
      onGenerateTextBasedAnswer: onGenerateThreadResponseAnswer,
      onGenerateChartAnswer: onGenerateThreadResponseChart,
      onAdjustChartAnswer: onAdjustThreadResponseChart,
      onOpenSaveToKnowledgeModal: questionSqlPairModal.openModal,
      onOpenAdjustReasoningStepsModal: adjustReasoningStepsModal.openModal,
      onOpenAdjustSQLModal: adjustSqlModal.openModal,
    };
  }, [
    adjustAnswer.onReRun,
    adjustAnswer.onStop,
    askPrompt.data?.askingStreamTask,
    askPrompt.onReRun,
    askPrompt.onStop,
    onAdjustThreadResponseChart,
    onCreateResponse,
    onFixSQLStatement,
    onGenerateThreadRecommendedQuestions,
    onGenerateThreadResponseAnswer,
    onGenerateThreadResponseChart,
    questionSqlPairModal.openModal,
    recommendedQuestions,
    saveAsViewModal.openModal,
    showRecommendedQuestions,
    thread,
    threadResponseUpdating,
    adjustReasoningStepsModal.openModal,
    adjustSqlModal.openModal,
  ]);

  const latestResponse = responses[responses.length - 1] || null;
  const shouldForceReferencePreview = useMemo(() => {
    const raw = router.query.referencePreview;
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value === '1';
  }, [router.query.referencePreview]);
  const shouldUseReferencePreview =
    shouldForceReferencePreview &&
    (!hasExecutableRuntime || !hasReferenceRenderableResponse(latestResponse));
  const primaryQuestion = shouldUseReferencePreview
    ? responses[0]?.question ||
      latestResponse?.question ||
      REFERENCE_PRIMARY_QUESTION
    : responses[0]?.question ||
      thread?.summary ||
      latestResponse?.question ||
      `对话 #${threadId}`;
  const threadPageLoading =
    runtimeScopePage.guarding || threadLoading || !providerValue;

  if (!providerValue) {
    return (
      <ConsoleShellLayout
        activeHistoryId={threadId ? String(threadId) : null}
        title={primaryQuestion}
        hideHeader
        contentBorderless
        loading={threadPageLoading}
        navItems={buildNovaShellNavItems({
          onNavigate: runtimeScopeNavigation.pushWorkspace,
        })}
      />
    );
  }

  return (
    <PromptThreadProvider value={providerValue}>
      <ConsoleShellLayout
        activeHistoryId={threadId ? String(threadId) : null}
        title={primaryQuestion}
        hideHeader
        contentBorderless
        loading={threadPageLoading}
        navItems={buildNovaShellNavItems({
          onNavigate: runtimeScopeNavigation.pushWorkspace,
        })}
      >
        <ThreadScene>
          <ConversationPane>
            <ConversationBody>
              {shouldUseReferencePreview ? (
                <ReferenceConversationPreview
                  question={primaryQuestion}
                  onSelectSuggestedQuestion={(value) => {
                    $prompt.current?.submit(value);
                  }}
                />
              ) : (
                <PromptThread />
              )}
            </ConversationBody>

            <ComposerDock>
              <ComposerFrame>
                {selectedKnowledgeBaseNames.length > 0 ? (
                  <ComposerSelectedScopeRow>
                    {selectedKnowledgeBaseNames.map((knowledgeBaseName) => (
                      <ComposerSelectedKnowledgeChip key={knowledgeBaseName}>
                        <BookOutlined />
                        <span>{knowledgeBaseName}</span>
                      </ComposerSelectedKnowledgeChip>
                    ))}
                  </ComposerSelectedScopeRow>
                ) : null}
                {hasExecutableRuntime ? (
                  <Prompt
                    ref={$prompt}
                    {...askPrompt}
                    onCreateResponse={onCreateResponse}
                    variant="embedded"
                    buttonMode="icon"
                  />
                ) : (
                  <ComposerAssistRow>
                    <ComposerHintText>
                      {isHistoricalRuntimeReadonly
                        ? HISTORICAL_SNAPSHOT_READONLY_HINT
                        : '当前知识库暂不可继续追问，请先确认已接入可用数据资产。'}
                    </ComposerHintText>
                  </ComposerAssistRow>
                )}
              </ComposerFrame>
            </ComposerDock>
          </ConversationPane>
        </ThreadScene>
      </ConsoleShellLayout>
      <SaveAsViewModal
        {...saveAsViewModal.state}
        loading={creating}
        onClose={saveAsViewModal.closeModal}
        onSubmit={handleCreateView}
      />
      <QuestionSQLPairModal
        {...questionSqlPairModal.state}
        onClose={questionSqlPairModal.closeModal}
        loading={createSqlPairLoading}
        onSubmit={async ({ data }: { data: CreateSqlPairInput }) => {
          await handleCreateSqlPair(data);
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
    </PromptThreadProvider>
  );
}

function ReferenceConversationPreview({
  question,
  onSelectSuggestedQuestion,
}: {
  question: string;
  onSelectSuggestedQuestion?: (value: string) => void;
}) {
  return (
    <ReferenceConversation>
      <SpeakerRow>
        <SpeakerBadge $tone="user">XL</SpeakerBadge>
        <Bubble>
          <Text
            strong
            style={{
              display: 'block',
              fontSize: 18,
              color: '#252b3a',
              marginBottom: 6,
            }}
          >
            {question}
          </Text>
          <Text type="secondary" style={{ fontSize: 13 }}>
            当前示例会沿用该线程历史使用的知识库继续分析，你可以直接继续追问。
          </Text>
        </Bubble>
      </SpeakerRow>

      <SpeakerRow>
        <SpeakerBadge $tone="assistant">AI</SpeakerBadge>
        <StatusLine>谢谢你的提问，我正在处理中。</StatusLine>
      </SpeakerRow>

      <div style={{ paddingLeft: 46 }}>
        <ThinkingLine>实时模式下这里会展示执行思路与推理过程</ThinkingLine>
      </div>

      <InlinePreviewCard>
        <InlineCardMeta>
          <Text strong>数据预览</Text>
          <Text type="secondary">每个供应商单个产品成本趋势是什么？</Text>
        </InlineCardMeta>
        <SubtleBadge>示例结果</SubtleBadge>
      </InlinePreviewCard>

      <InsightBlock>
        <p>
          本次分析使用了 <b>供应商信息</b>、<b>产品信息</b> 与
          <b>生产成本记录</b> 来识别每个供应商在不同批次下的单件成本变化。
        </p>
        <p>
          当前样例中，成本趋势以散点方式呈现：每个点代表一个 SKU
          在某个批次下的单位成本， 方便快速识别高成本批次与波动异常。
        </p>
        <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
          <li>供应商 1：SKU67 约 7.06，SKU52 约 9.17，SKU56 约 12.84</li>
          <li>供应商 2：SKU99 约 38.07，SKU9 约 47.96，SKU45 约 66.31</li>
          <li>供应商 3：不同 SKU 分布更分散，建议继续按批次筛选追问</li>
        </ul>
      </InsightBlock>

      <SuggestionShell>
        <Text type="secondary">推荐追问</Text>
        <SuggestionChipRow>
          {REFERENCE_FOLLOW_UPS.map((item) => (
            <SuggestionChip
              key={item}
              type="button"
              onClick={() => onSelectSuggestedQuestion?.(item)}
            >
              {item}
            </SuggestionChip>
          ))}
        </SuggestionChipRow>
      </SuggestionShell>
    </ReferenceConversation>
  );
}
