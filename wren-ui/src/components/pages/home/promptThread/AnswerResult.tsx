import { useMemo } from 'react';
import { isEmpty } from 'lodash';
import clsx from 'clsx';
import { Button, Typography, Tabs, Tag, Tooltip } from 'antd';
import styled from 'styled-components';
import CheckCircleFilled from '@ant-design/icons/CheckCircleFilled';
import CodeFilled from '@ant-design/icons/CodeFilled';
import PieChartFilled from '@ant-design/icons/PieChartFilled';
import MessageOutlined from '@ant-design/icons/MessageOutlined';
import { RecommendedQuestionsProps } from '@/components/pages/home/promptThread';
import RecommendedQuestions, {
  getRecommendedQuestionProps,
} from '@/components/pages/home/RecommendedQuestions';
import ViewBlock from '@/components/pages/home/promptThread/ViewBlock';
import BreakdownAnswer from '@/components/pages/home/promptThread/BreakdownAnswer';
import TextBasedAnswer from '@/components/pages/home/promptThread/TextBasedAnswer';
import ChartAnswer from '@/components/pages/home/promptThread/ChartAnswer';
import {
  AdjustThreadResponseChartInput,
  ThreadResponse,
} from '@/apollo/client/graphql/__types__';
import { ANSWER_TAB_KEYS } from '@/utils/enum';
import { RobotSVG } from '@/utils/svgs';

const { Title, Text } = Typography;

const knowledgeTooltip = (
  <>
    Store this answer as a Question-SQL pair to help Wren AI improve SQL
    generation.
    <br />
    <Typography.Link
      className="gray-1 underline"
      href="https://docs.getwren.ai/oss/guide/knowledge/question-sql-pairs#save-to-knowledge"
      target="_blank"
      rel="noopener noreferrer"
    >
      Learn more
    </Typography.Link>
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
  onOpenSaveAsViewModal: (data: { sql: string; responseId: number }) => void;
  onInitPreviewDone: () => void;

  // recommended questions
  recommendedQuestionsProps: RecommendedQuestionsProps;

  onRegenerateTextBasedAnswer: (responseId: number) => void;
  onGenerateBreakdownAnswer: (responseId: number) => void;
  onGenerateChartAnswer: (responseId: number) => Promise<void>;
  onAdjustChartAnswer: (
    responseId: number,
    data: AdjustThreadResponseChartInput,
  ) => Promise<void>;
  onOpenSaveToKnowledgeModal: (
    data: { sql: string; question: string },
    payload: { isCreateMode: boolean },
  ) => void;
}

const QuestionTitle = (props) => {
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
  recommendedQuestionProps,
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

export default function AnswerResult(props: Props) {
  const {
    motion,
    threadResponse,
    isLastThreadResponse,
    onOpenSaveAsViewModal,
    onInitPreviewDone,
    recommendedQuestionsProps,
    onGenerateBreakdownAnswer,
    onRegenerateTextBasedAnswer,
    onGenerateChartAnswer,
    onAdjustChartAnswer,
    onOpenSaveToKnowledgeModal,
  } = props;

  const { answerDetail, breakdownDetail, id, question, sql, view } =
    threadResponse;

  const resultStyle = isLastThreadResponse
    ? { minHeight: 'calc(100vh - (194px))' }
    : null;

  const recommendedQuestionProps = getRecommendedQuestionProps(
    recommendedQuestionsProps.data,
    recommendedQuestionsProps.show,
  );

  const isBreakdownOnly = useMemo(() => {
    // we support rendering different types of answers now, so we need to check if it's old data.
    // existing thread response's answerDetail is null.
    return answerDetail === null && !isEmpty(breakdownDetail);
  }, [answerDetail, breakdownDetail]);

  const onTabClick = (activeKey: string) => {
    if (
      activeKey === ANSWER_TAB_KEYS.VIEW_SQL &&
      !threadResponse.breakdownDetail
    ) {
      onGenerateBreakdownAnswer(id);
    }

    if (activeKey === ANSWER_TAB_KEYS.CHART && !threadResponse.chartDetail) {
      onGenerateChartAnswer(id);
    }
  };

  return (
    <div style={resultStyle} className="adm-answer-result">
      <QuestionTitle className="mb-6" question={question} />
      <StyledTabs type="card" size="small" onTabClick={onTabClick}>
        {!isBreakdownOnly && (
          <Tabs.TabPane
            key={ANSWER_TAB_KEYS.ANSWER}
            tab={
              <>
                <CheckCircleFilled className="mr-2" />
                <Text>Answer</Text>
              </>
            }
          >
            <TextBasedAnswer
              threadResponse={threadResponse}
              isLastThreadResponse={isLastThreadResponse}
              onInitPreviewDone={onInitPreviewDone}
              onRegenerateTextBasedAnswer={onRegenerateTextBasedAnswer}
            />
          </Tabs.TabPane>
        )}
        <Tabs.TabPane
          key={ANSWER_TAB_KEYS.VIEW_SQL}
          tab={
            <>
              <CodeFilled className="mr-2" />
              <Text>View SQL</Text>
            </>
          }
        >
          <BreakdownAnswer
            motion={motion}
            threadResponse={threadResponse}
            isLastThreadResponse={isLastThreadResponse}
            onInitPreviewDone={onInitPreviewDone}
          />
        </Tabs.TabPane>
        <Tabs.TabPane
          key="chart"
          tab={
            <>
              <PieChartFilled className="mr-2" />
              <Text>
                Chart<Tag className="adm-beta-tag">Beta</Tag>
              </Text>
            </>
          }
        >
          <ChartAnswer
            threadResponse={threadResponse}
            onRegenerateChartAnswer={onGenerateChartAnswer}
            onAdjustChartAnswer={onAdjustChartAnswer}
          />
        </Tabs.TabPane>
      </StyledTabs>
      <div className="mt-2">
        <Tooltip
          overlayInnerStyle={{ width: 'max-content' }}
          placement="topLeft"
          title={knowledgeTooltip}
        >
          <Button
            type="link"
            size="small"
            className="mr-2"
            onClick={() =>
              onOpenSaveToKnowledgeModal(
                { question, sql },
                { isCreateMode: true },
              )
            }
            data-guideid="save-to-knowledge"
          >
            <div className="d-flex align-center">
              <RobotSVG className="mr-2" />
              Save to Knowledge
            </div>
          </Button>
        </Tooltip>
        <ViewBlock
          view={view}
          onClick={() => onOpenSaveAsViewModal({ sql, responseId: id })}
        />
      </div>
      {renderRecommendedQuestions(
        isLastThreadResponse,
        recommendedQuestionProps,
        recommendedQuestionsProps.onSelect,
      )}
    </div>
  );
}
