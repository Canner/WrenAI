import { ViewInfo } from '@/types/modeling';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isEmpty } from 'lodash';
import { Alert, Button, Tag, Tooltip } from 'antd';
import styled from 'styled-components';
import LikeOutlined from '@ant-design/icons/LikeOutlined';
import DislikeOutlined from '@ant-design/icons/DislikeOutlined';
import EyeOutlined from '@ant-design/icons/EyeOutlined';
import PieChartOutlined from '@ant-design/icons/PieChartOutlined';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import ShareAltOutlined from '@ant-design/icons/ShareAltOutlined';
import { RobotSVG } from '@/utils/svgs';
import {
  usePromptThreadActionsStore,
  usePromptThreadDataStore,
  usePromptThreadPreparationStore,
} from './store';
import {
  AskingTaskStatus,
  ChartTaskStatus,
  ThreadResponse,
  ThreadResponseAdjustment,
  ThreadResponseAdjustmentType,
  ThreadResponseKind,
} from '@/types/home';
import type { ConversationAidItem } from '@/types/homeIntent';
import ViewBlock from '@/components/pages/home/promptThread/ViewBlock';
import TextBasedAnswer from '@/components/pages/home/promptThread/TextBasedAnswer';
import RecommendedQuestions from '@/components/pages/home/RecommendedQuestions';
import Preparation from '@/components/pages/home/preparation';
import {
  scheduleAutoGenerateAnswer,
  shouldAutoGenerateAnswer,
} from './answerGeneration';
import {
  findExistingChartFollowUpResponse,
  hasResponsePreviewArtifact,
  isRenderableWorkbenchArtifact,
  resolveFallbackWorkbenchArtifact,
  resolvePrimaryWorkbenchArtifact,
  resolveResponseTeasers,
} from '@/features/home/thread/threadWorkbenchState';
import { useThreadWorkbenchMessages } from '@/features/home/thread/threadWorkbenchMessages';

const adjustmentType = {
  [ThreadResponseAdjustmentType.APPLY_SQL]: '已应用手动 SQL',
  [ThreadResponseAdjustmentType.REASONING]: '已调整推理步骤',
};

const ResponseCard = styled.div<{ $selected?: boolean }>`
  position: relative;
  padding: 2px 0 6px;
  border-radius: 18px;
  transition: background 0.18s ease;

  &:hover {
    background: rgba(248, 250, 252, 0.34);
  }
`;

const ResponseBodyStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const ArtifactTeaserGrid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const ArtifactTeaserCard = styled.div`
  border: 1px solid rgba(15, 23, 42, 0.055);
  border-radius: 12px;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.9) 0%,
    rgba(248, 250, 252, 0.88) 100%
  );
  padding: 10px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
`;

const ArtifactTeaserHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-start;
  flex-wrap: wrap;
  gap: 8px;
`;

const ArtifactTeaserTitle = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  font-weight: 600;
  color: #273142;
`;

const ArtifactTeaserBody = styled.div`
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const ArtifactTeaserMeta = styled.div`
  font-size: 12px;
  line-height: 1.45;
  color: #667085;
  min-width: 0;
`;

const ArtifactTeaserAction = styled.div`
  flex-shrink: 0;
  margin-left: auto;
`;

const ResponseCardFooter = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 2px;
`;

const HelpfulBubble = styled.div`
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 2px 0 0;
  border-radius: 999px;
  border: 0;
  background: transparent;
  color: #667085;
  font-size: 11.5px;
  line-height: 1;
`;

const HelpfulText = styled.span`
  font-weight: 400;
  color: #5b6475;
`;

const HelpfulIconButton = styled(Button)<{ $selected?: boolean }>`
  && {
    width: 28px;
    height: 28px;
    min-width: 28px;
    border: 0;
    border-radius: 999px;
    color: ${(props) => (props.$selected ? '#6f47ff' : '#667085')};
    background: ${(props) =>
      props.$selected ? 'rgba(111, 71, 255, 0.12)' : 'transparent'};
    box-shadow: none;
  }
`;

const FooterActionGroup = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  margin-right: -4px;
`;

const FooterIconActionButton = styled(Button)`
  && {
    width: 28px;
    height: 28px;
    min-width: 28px;
    border-radius: 999px;
    color: #4b5563;
  }
`;

const QuestionBubbleRow = styled.div`
  display: flex;
  justify-content: flex-end;
  padding-left: 76px;
`;

const QuestionBubble = styled.div<{ $selected?: boolean }>`
  width: fit-content;
  max-width: min(100%, 76%);
  padding: 12px 15px;
  border-radius: 18px 18px 6px 18px;
  border: 1px solid
    ${(props) =>
      props.$selected ? 'rgba(111, 71, 255, 0.16)' : 'rgba(15, 23, 42, 0.06)'};
  background: ${(props) =>
    props.$selected
      ? 'rgba(248, 245, 255, 0.92)'
      : 'rgba(249, 250, 251, 0.94)'};
`;

const QuestionBubbleText = styled.h4`
  margin: 0;
  color: #1f2937;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.55;
`;

const AssistantSection = styled.div<{ $selected?: boolean }>`
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding-left: 2px;

  &::before {
    content: '';
    position: absolute;
    left: 14px;
    top: 34px;
    bottom: 8px;
    width: 1px;
    background: ${(props) =>
      props.$selected
        ? 'linear-gradient(180deg, rgba(111, 71, 255, 0.16) 0%, rgba(111, 71, 255, 0.02) 100%)'
        : 'linear-gradient(180deg, rgba(15, 23, 42, 0.08) 0%, rgba(15, 23, 42, 0.02) 100%)'};
  }
`;

const AssistantAvatar = styled.div<{ $selected?: boolean }>`
  width: 30px;
  height: 30px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: ${(props) =>
    props.$selected
      ? 'linear-gradient(135deg, rgba(111, 71, 255, 0.18) 0%, rgba(111, 71, 255, 0.08) 100%)'
      : 'rgba(15, 23, 42, 0.06)'};
  color: ${(props) => (props.$selected ? '#6f47ff' : '#5b6475')};
  flex-shrink: 0;
  margin-top: 2px;
  position: relative;
  z-index: 1;

  svg {
    width: 14px;
    height: 14px;
  }
`;

const AssistantMain = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const AssistantIdentityRow = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
`;

const AssistantIdentityName = styled.span`
  color: #253041;
  font-size: 13px;
  font-weight: 600;
`;

const AssistantIdentityMeta = styled.span`
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.04);
  color: #667085;
  font-size: 11px;
  font-weight: 500;
`;

const ChartFollowUpLeadLine = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  width: 100%;
  padding: 0 12px;
  border-radius: 12px;
  border: 1px solid rgba(111, 71, 255, 0.1);
  background: linear-gradient(
    90deg,
    rgba(111, 71, 255, 0.08) 0%,
    rgba(236, 72, 153, 0.04) 55%,
    rgba(255, 255, 255, 0.92) 100%
  );
  color: #5b6475;
  font-size: 12px;
  line-height: 1.5;
`;

const RecommendedQuestionsSlot = styled.div`
  padding-top: 2px;
`;

const ConversationAidsShell = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 2px;
`;

const ConversationAidChip = styled.button`
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: #fff;
  color: #344054;
  border-radius: 999px;
  min-height: 32px;
  padding: 0 12px;
  font-size: 12.5px;
  font-weight: 500;
  line-height: 1.3;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    color 0.18s ease,
    transform 0.18s ease,
    box-shadow 0.18s ease;

  &:hover {
    border-color: rgba(111, 71, 255, 0.22);
    color: var(--nova-primary-strong);
    box-shadow: 0 6px 14px rgba(111, 71, 255, 0.06);
    transform: translateY(-1px);
  }
`;

export interface Props {
  motion: boolean;
  threadResponse: ThreadResponse;
  isLastThreadResponse: boolean;
  isOpeningQuestion: boolean;
  shouldAutoPreview: boolean;
  onInitPreviewDone: () => void;
  recommendedQuestions?: {
    items: { question: string; sql: string }[];
    loading: boolean;
    error?: {
      shortMessage?: string | null;
      code?: string | null;
      message?: string | null;
      stacktrace?: (string | null)[] | null;
    } | null;
  } | null;
  mode?: 'timeline' | 'workbench';
}

const QuestionTitle = (props: {
  question: string;
  selected?: boolean;
  className?: string;
}) => {
  const { question, className, selected } = props;
  return (
    <QuestionBubbleRow className={className}>
      <QuestionBubble $selected={selected}>
        <QuestionBubbleText>{question}</QuestionBubbleText>
      </QuestionBubble>
    </QuestionBubbleRow>
  );
};

const AdjustmentInformation = (props: {
  adjustment: ThreadResponseAdjustment;
}) => {
  const { adjustment } = props;

  return (
    <div className="rounded bg-gray-3 gray-6 py-2 px-3 mb-3">
      <div className="d-flex align-center gx-2">
        <ShareAltOutlined className="gray-7" />
        <div className="flex-grow-1 gray-7">
          已调整回答
          <Tag className="gray-6 border border-gray-5 bg-gray-3 ml-3 text-medium">
            {adjustmentType[adjustment.type]}
          </Tag>
        </div>
      </div>
    </div>
  );
};

export default function AnswerResult(props: Props) {
  const { threadResponse, isOpeningQuestion, recommendedQuestions } = props;
  const messages = useThreadWorkbenchMessages();
  const [helpfulFeedback, setHelpfulFeedback] = useState<
    'positive' | 'negative' | null
  >(null);

  const {
    onDraftConversationAid,
    onSelectRecommendedQuestion,
    onGenerateTextBasedAnswer,
    onGenerateChartAnswer,
    onOpenSaveAsViewModal,
    onOpenSaveToKnowledgeModal,
    onSelectResponse,
  } = usePromptThreadActionsStore();
  const { data, selectedResponseId } = usePromptThreadDataStore();
  const { preparation } = usePromptThreadPreparationStore();

  const {
    askingTask,
    adjustmentTask,
    answerDetail,
    breakdownDetail,
    id,
    question,
    responseKind,
    sql,
    view,
    adjustment,
  } = threadResponse;

  const isAdjustment = !!adjustment;
  const isSelected = selectedResponseId === id;
  const normalizedResponseKind = responseKind || ThreadResponseKind.ANSWER;
  const isChartFollowUp =
    normalizedResponseKind === ThreadResponseKind.CHART_FOLLOWUP;

  const isAnswerPrepared = !!answerDetail?.queryId || !!answerDetail?.status;
  const isBreakdownOnly = useMemo(() => {
    return answerDetail === null && !isEmpty(breakdownDetail);
  }, [answerDetail, breakdownDetail]);

  const shouldInitializeAnswer = useMemo(
    () =>
      !isChartFollowUp &&
      shouldAutoGenerateAnswer({
        isBreakdownOnly,
        askingTask,
        adjustmentTask,
        answerDetail,
        sql,
      }),
    [
      isChartFollowUp,
      isBreakdownOnly,
      askingTask,
      adjustmentTask,
      answerDetail,
      sql,
    ],
  );
  const autoGenerateRequestKey = useMemo(() => `${id}:${sql || ''}`, [id, sql]);
  const autoGenerateRequestRef = useRef<string | null>(null);

  useEffect(() => {
    if (!shouldInitializeAnswer) return;
    if (autoGenerateRequestRef.current === autoGenerateRequestKey) return;

    return scheduleAutoGenerateAnswer({
      requestRef: autoGenerateRequestRef,
      requestKey: autoGenerateRequestKey,
      onGenerate: () => {
        onGenerateTextBasedAnswer(id);
      },
    });
  }, [
    shouldInitializeAnswer,
    autoGenerateRequestKey,
    id,
    onGenerateTextBasedAnswer,
  ]);

  const rephrasedQuestion =
    threadResponse?.askingTask?.rephrasedQuestion || question;
  const normalizedView: ViewInfo | undefined = view || undefined;
  const sqlText = sql || '';
  const hasPreviewArtifact = hasResponsePreviewArtifact(threadResponse);
  const primaryArtifact = resolvePrimaryWorkbenchArtifact(threadResponse);
  const teaserArtifacts = resolveResponseTeasers(threadResponse);

  const existingChartResponse = useMemo(() => {
    if (isChartFollowUp) {
      return threadResponse;
    }

    return findExistingChartFollowUpResponse({
      responses: data.responses,
      sourceResponseId: id,
    });
  }, [data.responses, id, isChartFollowUp, threadResponse]);

  const questionForSaveAsView = useMemo(() => {
    if (isOpeningQuestion) return question;
    return rephrasedQuestion;
  }, [rephrasedQuestion, question, isOpeningQuestion]);

  const showAnswerBody =
    !isChartFollowUp &&
    (askingTask?.status === AskingTaskStatus.FINISHED ||
      isAnswerPrepared ||
      isBreakdownOnly);

  const chartArtifactResponse = isChartFollowUp
    ? threadResponse
    : existingChartResponse ||
      (isRenderableWorkbenchArtifact(threadResponse, 'chart')
        ? threadResponse
        : null);
  const chartStatus = chartArtifactResponse?.chartDetail?.status;
  const chartError = chartArtifactResponse?.chartDetail?.error;
  const hasChartArtifact = isRenderableWorkbenchArtifact(
    chartArtifactResponse,
    'chart',
  );
  const shouldMinimizePreparation = isChartFollowUp
    ? chartStatus === ChartTaskStatus.FINISHED
    : isAnswerPrepared;
  const fallbackArtifact =
    primaryArtifact || resolveFallbackWorkbenchArtifact(threadResponse);

  const selectCurrentResponse = () => {
    onSelectResponse(id, {
      artifact: fallbackArtifact,
      openWorkbench: Boolean(fallbackArtifact),
      userInitiated: true,
    });
  };

  const toggleHelpfulFeedback = (value: 'positive' | 'negative') => {
    setHelpfulFeedback((current) => (current === value ? null : value));
  };

  const renderResultFooter = () => {
    const shouldShowArtifactActions =
      !isChartFollowUp && (sqlText || normalizedView);

    return (
      <ResponseCardFooter>
        <HelpfulBubble onClick={(event) => event.stopPropagation()}>
          <HelpfulText>{messages.footer.helpfulPrompt}</HelpfulText>
          <Tooltip title={messages.footer.helpfulPositive}>
            <HelpfulIconButton
              aria-label={messages.footer.helpfulPositive}
              $selected={helpfulFeedback === 'positive'}
              icon={<LikeOutlined />}
              size="small"
              type="text"
              onClick={() => toggleHelpfulFeedback('positive')}
            />
          </Tooltip>
          <Tooltip title={messages.footer.helpfulNegative}>
            <HelpfulIconButton
              aria-label={messages.footer.helpfulNegative}
              $selected={helpfulFeedback === 'negative'}
              icon={<DislikeOutlined />}
              size="small"
              type="text"
              onClick={() => toggleHelpfulFeedback('negative')}
            />
          </Tooltip>
        </HelpfulBubble>

        {shouldShowArtifactActions ? (
          <FooterActionGroup onClick={(event) => event.stopPropagation()}>
            {sqlText ? (
              <Tooltip title={messages.footer.saveSqlTemplate}>
                <FooterIconActionButton
                  aria-label={messages.footer.saveSqlTemplate}
                  data-guideid="save-to-knowledge"
                  icon={<RobotSVG />}
                  size="small"
                  type="text"
                  onClick={() => {
                    onOpenSaveToKnowledgeModal(
                      { question: rephrasedQuestion, sql: sqlText },
                      { isCreateMode: true, responseId: id },
                    );
                  }}
                />
              </Tooltip>
            ) : null}

            <ViewBlock
              view={normalizedView}
              variant="icon"
              title={messages.footer.saveView}
              savedTitle={messages.footer.openSavedView}
              onClick={() =>
                onOpenSaveAsViewModal(
                  { sql: sqlText, responseId: id },
                  {
                    rephrasedQuestion: questionForSaveAsView,
                  },
                )
              }
            />
          </FooterActionGroup>
        ) : null}
      </ResponseCardFooter>
    );
  };

  const renderPreviewTeaser = () => {
    if (
      isChartFollowUp ||
      !hasPreviewArtifact ||
      !teaserArtifacts.includes('preview_teaser')
    ) {
      return null;
    }

    return (
      <ArtifactTeaserCard>
        <ArtifactTeaserBody>
          <ArtifactTeaserHeader>
            <ArtifactTeaserTitle>
              <EyeOutlined />
              <span>{messages.preview.teaserTitle}</span>
            </ArtifactTeaserTitle>
            <Tag color="blue">{messages.preview.teaserTag}</Tag>
          </ArtifactTeaserHeader>
          <ArtifactTeaserMeta>
            {messages.preview.teaserDescription}
          </ArtifactTeaserMeta>
        </ArtifactTeaserBody>
        <ArtifactTeaserAction>
          <Button
            type="link"
            size="small"
            onClick={(event) => {
              event.stopPropagation();
              onSelectResponse(id, {
                artifact: 'preview',
                openWorkbench: true,
                userInitiated: true,
              });
            }}
          >
            {messages.preview.teaserAction}
          </Button>
        </ArtifactTeaserAction>
      </ArtifactTeaserCard>
    );
  };

  const renderChartTeaser = () => {
    if (!teaserArtifacts.includes('chart_teaser')) {
      return null;
    }

    if (isChartFollowUp) {
      return (
        <ArtifactTeaserCard>
          <ArtifactTeaserBody>
            <ArtifactTeaserHeader>
              <ArtifactTeaserTitle>
                <PieChartOutlined />
                <span>{messages.chart.teaserTitle}</span>
              </ArtifactTeaserTitle>
              {chartStatus === ChartTaskStatus.FINISHED ? (
                <Tag color="purple">{messages.chart.statuses.generated}</Tag>
              ) : chartStatus === ChartTaskStatus.FAILED ? (
                <Tag color="error">{messages.chart.statuses.failed}</Tag>
              ) : (
                <Tag color="processing">
                  {messages.chart.statuses.generating}
                </Tag>
              )}
            </ArtifactTeaserHeader>
            <ArtifactTeaserMeta>
              {chartStatus === ChartTaskStatus.FAILED
                ? chartError?.message ||
                  messages.chart.descriptions.noChartFallback
                : chartStatus === ChartTaskStatus.FINISHED
                  ? messages.chart.descriptions.followUpReady
                  : messages.chart.descriptions.followUpGenerating}
            </ArtifactTeaserMeta>
          </ArtifactTeaserBody>
          <ArtifactTeaserAction>
            {hasChartArtifact ? (
              <Button
                type="link"
                size="small"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectResponse(id, {
                    artifact: 'chart',
                    openWorkbench: true,
                    userInitiated: true,
                  });
                }}
              >
                {messages.chart.actions.view}
              </Button>
            ) : chartStatus === ChartTaskStatus.FAILED ? (
              <Button
                icon={<ReloadOutlined />}
                size="small"
                type="link"
                onClick={(event) => {
                  event.stopPropagation();
                  void onGenerateChartAnswer(id);
                }}
              >
                {messages.chart.actions.regenerate}
              </Button>
            ) : (
              <Button size="small" type="link" disabled>
                {messages.chart.actions.generating}
              </Button>
            )}
          </ArtifactTeaserAction>
        </ArtifactTeaserCard>
      );
    }

    return (
      <ArtifactTeaserCard>
        <ArtifactTeaserBody>
          <ArtifactTeaserHeader>
            <ArtifactTeaserTitle>
              <PieChartOutlined />
              <span>{messages.chart.teaserTitle}</span>
            </ArtifactTeaserTitle>
            {hasChartArtifact ? (
              <Tag color="purple">{messages.chart.statuses.generated}</Tag>
            ) : chartStatus === ChartTaskStatus.FAILED ? (
              <Tag color="error">{messages.chart.statuses.failed}</Tag>
            ) : chartStatus ? (
              <Tag color="processing">{messages.chart.statuses.generating}</Tag>
            ) : (
              <Tag>{messages.chart.statuses.enhance}</Tag>
            )}
          </ArtifactTeaserHeader>
          <ArtifactTeaserMeta>
            {hasChartArtifact
              ? messages.chart.descriptions.askReady
              : chartStatus === ChartTaskStatus.FAILED
                ? chartError?.message || messages.chart.descriptions.askFailed
                : chartStatus
                  ? messages.chart.descriptions.askGenerating
                  : messages.chart.descriptions.askCreate}
          </ArtifactTeaserMeta>
        </ArtifactTeaserBody>
        <ArtifactTeaserAction>
          {hasChartArtifact && chartArtifactResponse ? (
            <Button
              size="small"
              type="link"
              onClick={(event) => {
                event.stopPropagation();
                onSelectResponse(chartArtifactResponse.id, {
                  artifact: 'chart',
                  openWorkbench: true,
                  userInitiated: true,
                });
              }}
            >
              {messages.chart.actions.view}
            </Button>
          ) : chartStatus === ChartTaskStatus.FAILED &&
            chartArtifactResponse ? (
            <Button
              icon={<ReloadOutlined />}
              size="small"
              type="link"
              onClick={(event) => {
                event.stopPropagation();
                void onGenerateChartAnswer(chartArtifactResponse.id);
              }}
            >
              {messages.chart.actions.regenerate}
            </Button>
          ) : chartStatus ? (
            <Button
              size="small"
              type="link"
              disabled
              onClick={(event) => event.stopPropagation()}
            >
              {messages.chart.actions.generating}
            </Button>
          ) : (
            <Button
              size="small"
              type="link"
              onClick={(event) => {
                event.stopPropagation();
                void onGenerateChartAnswer(id, {
                  question: messages.chart.syntheticQuestion,
                  sourceResponseId: id,
                });
              }}
            >
              {messages.chart.actions.create}
            </Button>
          )}
        </ArtifactTeaserAction>
      </ArtifactTeaserCard>
    );
  };

  const chartFollowUpLeadText =
    chartStatus === ChartTaskStatus.FAILED
      ? chartError?.message || messages.chart.descriptions.noChartFallback
      : chartStatus === ChartTaskStatus.FINISHED
        ? messages.chart.descriptions.followUpReady
        : messages.chart.descriptions.followUpGenerating;
  const previewTeaser = renderPreviewTeaser();
  const chartTeaser = renderChartTeaser();
  const conversationAids = useMemo(() => {
    const aids =
      threadResponse.resolvedIntent?.conversationAidPlan?.responseAids || [];
    if (!recommendedQuestions) {
      return aids;
    }

    return aids.filter((aid) => aid.kind !== 'TRIGGER_RECOMMEND_QUESTIONS');
  }, [
    recommendedQuestions,
    threadResponse.resolvedIntent?.conversationAidPlan?.responseAids,
  ]);
  const isResponseSettledForConversationAids = isChartFollowUp
    ? chartStatus === ChartTaskStatus.FINISHED ||
      chartStatus === ChartTaskStatus.FAILED
    : Boolean(
        askingTask?.status === AskingTaskStatus.FINISHED ||
        isAnswerPrepared ||
        isBreakdownOnly ||
        sqlText,
      );
  const shouldRenderConversationAids =
    isSelected &&
    isResponseSettledForConversationAids &&
    conversationAids.length > 0;

  const renderConversationAids = () => {
    if (!shouldRenderConversationAids) {
      return null;
    }

    return (
      <ConversationAidsShell onClick={(event) => event.stopPropagation()}>
        {conversationAids.map((aid: ConversationAidItem) => (
          <ConversationAidChip
            key={`${aid.kind}:${aid.prompt}`}
            type="button"
            onClick={() => {
              if (aid.interactionMode !== 'draft_to_composer') {
                return;
              }

              onDraftConversationAid({
                intentHint:
                  aid.suggestedIntent ||
                  (aid.kind === 'TRIGGER_RECOMMEND_QUESTIONS'
                    ? 'RECOMMEND_QUESTIONS'
                    : 'CHART'),
                prompt: aid.prompt,
                sourceAidKind: aid.kind,
                sourceResponseId: aid.sourceResponseId ?? id,
              });
            }}
          >
            {aid.label}
          </ConversationAidChip>
        ))}
      </ConversationAidsShell>
    );
  };

  return (
    <div data-jsid="answerResult">
      <ResponseCard $selected={isSelected} onClick={selectCurrentResponse}>
        <ResponseBodyStack>
          <QuestionTitle
            className="mb-0"
            question={question}
            selected={isSelected}
          />
          <AssistantSection $selected={isSelected}>
            <AssistantAvatar $selected={isSelected}>
              <RobotSVG />
            </AssistantAvatar>
            <AssistantMain>
              <AssistantIdentityRow>
                <AssistantIdentityName>Nova</AssistantIdentityName>
                <AssistantIdentityMeta>
                  {isChartFollowUp ? '图表追问' : '自动分析'}
                </AssistantIdentityMeta>
              </AssistantIdentityRow>

              {isAdjustment ? (
                <AdjustmentInformation adjustment={adjustment} />
              ) : null}

              {isChartFollowUp ? (
                <ChartFollowUpLeadLine>
                  <PieChartOutlined />
                  <span>{chartFollowUpLeadText}</span>
                </ChartFollowUpLeadLine>
              ) : null}

              <Preparation
                className="mb-0"
                {...preparation}
                data={threadResponse}
                minimized={shouldMinimizePreparation}
              />
              {previewTeaser}
              {showAnswerBody ? <TextBasedAnswer {...props} /> : null}

              {isChartFollowUp &&
              chartStatus === ChartTaskStatus.FAILED &&
              chartError ? (
                <Alert
                  className="mt-1"
                  type="error"
                  showIcon
                  title={
                    chartError.shortMessage || messages.chart.alerts.failedShort
                  }
                  description={chartError.message}
                />
              ) : null}

              {chartTeaser ? (
                <ArtifactTeaserGrid>{chartTeaser}</ArtifactTeaserGrid>
              ) : null}

              {renderConversationAids()}

              {renderResultFooter()}

              {recommendedQuestions && isSelected ? (
                <RecommendedQuestionsSlot
                  onClick={(event) => event.stopPropagation()}
                >
                  <RecommendedQuestions
                    {...recommendedQuestions}
                    onSelect={onSelectRecommendedQuestion}
                  />
                </RecommendedQuestionsSlot>
              ) : null}
            </AssistantMain>
          </AssistantSection>
        </ResponseBodyStack>
      </ResponseCard>
    </div>
  );
}
