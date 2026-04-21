import { ViewInfo } from '@/types/modeling';
import { CSSProperties, useEffect, useMemo, useRef } from 'react';
import { isEmpty } from 'lodash';
import clsx from 'clsx';
import { Button, Typography, Tabs, Tag, Tooltip } from 'antd';
import styled from 'styled-components';
import CheckCircleFilled from '@ant-design/icons/CheckCircleFilled';
import CodeFilled from '@ant-design/icons/CodeFilled';
import PieChartFilled from '@ant-design/icons/PieChartFilled';
import MessageOutlined from '@ant-design/icons/MessageOutlined';
import ShareAltOutlined from '@ant-design/icons/ShareAltOutlined';
import { RobotSVG } from '@/utils/svgs';
import { ANSWER_TAB_KEYS } from '@/utils/enum';
import {
  usePromptThreadActionsStore,
  usePromptThreadDataStore,
  usePromptThreadPreparationStore,
} from './store';
import {
  AskingTaskStatus,
  ThreadResponse,
  ThreadResponseAdjustment,
  ThreadResponseAdjustmentType,
} from '@/types/home';
import { RecommendedQuestionsProps } from '@/components/pages/home/promptThread';
import RecommendedQuestions, {
  getRecommendedQuestionProps,
  RecommendedQuestionRenderState,
} from '@/components/pages/home/RecommendedQuestions';
import ViewBlock from '@/components/pages/home/promptThread/ViewBlock';
import ViewSQLTabContent from '@/components/pages/home/promptThread/ViewSQLTabContent';
import TextBasedAnswer from '@/components/pages/home/promptThread/TextBasedAnswer';
import ChartAnswer from '@/components/pages/home/promptThread/ChartAnswer';
import Preparation from '@/components/pages/home/preparation';
import {
  scheduleAutoGenerateAnswer,
  shouldAutoGenerateAnswer,
} from './answerGeneration';

const { Title, Text } = Typography;

const adjustmentType = {
  [ThreadResponseAdjustmentType.APPLY_SQL]: '已应用手动 SQL',
  [ThreadResponseAdjustmentType.REASONING]: '已调整推理步骤',
};

const knowledgeTooltip = (
  <>
    将这条回答保存为 <b>SQL 模板</b>，帮助系统持续优化 SQL 生成效果。
  </>
);

const StyledTabs = styled(Tabs)`
  .ant-tabs-nav {
    margin-bottom: 0;
  }

  .ant-tabs-content-holder {
    border-left: 1px var(--gray-4) solid;
    border-right: 1px var(--gray-4) solid;
    border-bottom: 1px var(--gray-4) solid;
  }

  .ant-tabs-tab {
    .ant-typography {
      color: var(--gray-6);
    }

    [aria-label='check-circle'] {
      color: var(--gray-5);
    }

    [aria-label='code'] {
      color: var(--gray-5);
    }

    [aria-label='pie-chart'] {
      color: var(--gray-5);
    }

    &.ant-tabs-tab-active {
      .ant-typography {
        color: var(--gray-8);
      }

      [aria-label='check-circle'] {
        color: var(--green-5);
      }

      [aria-label='code'] {
        color: var(--geekblue-5);
      }

      [aria-label='pie-chart'] {
        color: var(--gold-6);
      }

      .adm-beta-tag {
        background-color: var(--geekblue-2);
        color: var(--geekblue-5);
      }
    }

    .adm-beta-tag {
      padding: 0 4px;
      line-height: 18px;
      margin: 0 0 0 6px;
      border-radius: 2px;
      background-color: var(--gray-5);
      color: white;
      border: none;
    }
  }
`;

export interface Props {
  motion: boolean;
  threadResponse: ThreadResponse;
  isLastThreadResponse: boolean;
  isOpeningQuestion: boolean;
  shouldAutoPreview: boolean;
  onInitPreviewDone: () => void;
}

const QuestionTitle = (props: { question: string; className?: string }) => {
  const { question, className } = props;
  return (
    <Title
      className={clsx('d-flex bg-gray-1 rounded mt-0', className)}
      level={4}
    >
      <MessageOutlined className="geekblue-5 mt-1 mr-3" />
      <Text className="text-medium gray-8">{question}</Text>
    </Title>
  );
};

const renderRecommendedQuestions = (
  isLastThreadResponse: boolean,
  recommendedQuestionProps: RecommendedQuestionRenderState,
  onSelect: RecommendedQuestionsProps['onSelect'],
) => {
  if (!isLastThreadResponse || !recommendedQuestionProps.show) return null;

  return (
    <RecommendedQuestions
      className="mt-5 mb-4"
      {...recommendedQuestionProps.state}
      onSelect={onSelect}
    />
  );
};

const AdjustmentInformation = (props: {
  adjustment: ThreadResponseAdjustment;
}) => {
  const { adjustment } = props;

  return (
    <div className="rounded bg-gray-3 gray-6 py-2 px-3 mb-2">
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
  const { threadResponse, isLastThreadResponse, isOpeningQuestion } = props;

  const {
    onOpenSaveAsViewModal,
    onGenerateThreadRecommendedQuestions,
    onGenerateTextBasedAnswer,
    onGenerateChartAnswer,
    onSelectRecommendedQuestion,
    onOpenSaveToKnowledgeModal,
  } = usePromptThreadActionsStore();
  const {
    // recommend questions
    recommendedQuestions,
    showRecommendedQuestions,
  } = usePromptThreadDataStore();
  const { preparation } = usePromptThreadPreparationStore();

  const {
    askingTask,
    adjustmentTask,
    answerDetail,
    breakdownDetail,
    id,
    question,
    sql,
    view,
    adjustment,
  } = threadResponse;

  const resultStyle: CSSProperties | undefined = isLastThreadResponse
    ? { minHeight: 'calc(100vh - (194px))' }
    : undefined;

  const isAdjustment = !!adjustment;

  const recommendedQuestionProps = getRecommendedQuestionProps(
    recommendedQuestions,
    showRecommendedQuestions,
  );

  const isAnswerPrepared = !!answerDetail?.queryId || !!answerDetail?.status;
  const isBreakdownOnly = useMemo(() => {
    // we support rendering different types of answers now, so we need to check if it's old data.
    // existing thread response's answerDetail is null.
    return answerDetail === null && !isEmpty(breakdownDetail);
  }, [answerDetail, breakdownDetail]);

  const shouldInitializeAnswer = useMemo(
    () =>
      shouldAutoGenerateAnswer({
        isBreakdownOnly,
        askingTask,
        adjustmentTask,
        answerDetail,
        sql,
      }),
    [isBreakdownOnly, askingTask, adjustmentTask, answerDetail, sql],
  );
  const autoGenerateRequestKey = useMemo(() => `${id}:${sql || ''}`, [id, sql]);
  const autoGenerateRequestRef = useRef<string | null>(null);

  // initialize generate answer
  useEffect(() => {
    if (!shouldInitializeAnswer) return;
    if (autoGenerateRequestRef.current === autoGenerateRequestKey) return;

    return scheduleAutoGenerateAnswer({
      requestRef: autoGenerateRequestRef,
      requestKey: autoGenerateRequestKey,
      onGenerate: () => {
        onGenerateTextBasedAnswer(id);
        onGenerateThreadRecommendedQuestions();
      },
    });
  }, [
    shouldInitializeAnswer,
    autoGenerateRequestKey,
    id,
    onGenerateTextBasedAnswer,
    onGenerateThreadRecommendedQuestions,
  ]);

  const onTabClick = (activeKey: string) => {
    if (activeKey === ANSWER_TAB_KEYS.CHART && !threadResponse.chartDetail) {
      onGenerateChartAnswer(id);
    }
  };

  const showAnswerTabs =
    askingTask?.status === AskingTaskStatus.FINISHED ||
    isAnswerPrepared ||
    isBreakdownOnly;

  const rephrasedQuestion =
    threadResponse?.askingTask?.rephrasedQuestion || question;
  const normalizedView: ViewInfo | undefined = view || undefined;
  const sqlText = sql || '';

  const questionForSaveAsView = useMemo(() => {
    // use rephrased question for follow-up questions, otherwise use the original question

    if (isOpeningQuestion) return question;

    return rephrasedQuestion;
  }, [rephrasedQuestion, question, isOpeningQuestion]);

  const answerTabItems = [
    ...(!isBreakdownOnly
      ? [
          {
            key: ANSWER_TAB_KEYS.ANSWER,
            label: (
              <div className="select-none">
                <CheckCircleFilled className="mr-2" />
                <Text>回答</Text>
              </div>
            ),
            children: <TextBasedAnswer {...props} />,
          },
        ]
      : []),
    {
      key: ANSWER_TAB_KEYS.VIEW_SQL,
      label: (
        <div className="select-none">
          <CodeFilled className="mr-2" />
          <Text>SQL 查询</Text>
        </div>
      ),
      children: <ViewSQLTabContent {...props} />,
    },
    {
      key: 'chart',
      label: (
        <div className="select-none">
          <PieChartFilled className="mr-2" />
          <Text>
            图表<Tag className="adm-beta-tag">测试版</Tag>
          </Text>
        </div>
      ),
      children: <ChartAnswer {...props} />,
    },
  ];

  return (
    <div style={resultStyle} data-jsid="answerResult">
      {isAdjustment && <AdjustmentInformation adjustment={adjustment} />}
      <QuestionTitle className="mb-4" question={question} />
      <Preparation
        className="mb-3"
        {...preparation}
        data={threadResponse}
        minimized={isAnswerPrepared}
      />
      {showAnswerTabs && (
        <>
          <StyledTabs
            type="card"
            size="small"
            onTabClick={onTabClick}
            items={answerTabItems}
          />
          {(sqlText || normalizedView) && (
            <div className="mt-2 d-flex align-center">
              {sql && (
                <Tooltip
                  styles={{ container: { width: 'max-content' } }}
                  placement="topLeft"
                  title={knowledgeTooltip}
                >
                  <Button
                    type="link"
                    size="small"
                    className="mr-2"
                    onClick={() =>
                      onOpenSaveToKnowledgeModal(
                        { question: rephrasedQuestion, sql },
                        { isCreateMode: true },
                      )
                    }
                    data-guideid="save-to-knowledge"
                  >
                    <div className="d-flex align-center">
                      <RobotSVG className="mr-2" />
                      存为 SQL 模板
                    </div>
                  </Button>
                </Tooltip>
              )}
              <ViewBlock
                view={normalizedView}
                onClick={() =>
                  onOpenSaveAsViewModal(
                    { sql: sqlText, responseId: id },
                    {
                      rephrasedQuestion: questionForSaveAsView,
                    },
                  )
                }
              />
            </div>
          )}
          {renderRecommendedQuestions(
            isLastThreadResponse,
            recommendedQuestionProps,
            onSelectRecommendedQuestion,
          )}
        </>
      )}
    </div>
  );
}
