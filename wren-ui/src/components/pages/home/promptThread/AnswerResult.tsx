import { useMemo } from 'react';
import { isEmpty } from 'lodash';
import clsx from 'clsx';
import { Typography, Tabs } from 'antd';
import styled from 'styled-components';
import CheckCircleFilled from '@ant-design/icons/CheckCircleFilled';
import CodeFilled from '@ant-design/icons/CodeFilled';
import MessageOutlined from '@ant-design/icons/MessageOutlined';
import { RecommendedQuestionsProps } from '@/components/pages/home/promptThread';
import RecommendedQuestions, {
  getRecommendedQuestionProps,
} from '@/components/pages/home/RecommendedQuestions';
import ViewBlock from '@/components/pages/home/promptThread/ViewBlock';
import BreakdownAnswer from '@/components/pages/home/promptThread/BreakdownAnswer';
import TextBasedAnswer from '@/components/pages/home/promptThread/TextBasedAnswer';
import { ThreadResponse } from '@/apollo/client/graphql/__types__';
import { ANSWER_TAB_KEYS } from '@/utils/enum';

const { Title, Text } = Typography;

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

    &.ant-tabs-tab-active {
      .ant-typography {
        color: var(--gray-8);
      }
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
  onGenerateBreakdownAnswer: (threadId: number, responseId: number) => void;
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
  } = props;

  const { answerDetail, breakdownDetail, id, question, sql, threadId, view } =
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
      onGenerateBreakdownAnswer(threadId, id);
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
                <CheckCircleFilled className="mr-2 green-6" />
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
              <CodeFilled className="mr-2 gray-7" />
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
      </StyledTabs>
      <ViewBlock
        view={view}
        onClick={() => onOpenSaveAsViewModal({ sql, responseId: id })}
      />
      {renderRecommendedQuestions(
        isLastThreadResponse,
        recommendedQuestionProps,
        recommendedQuestionsProps.onSelect,
      )}
    </div>
  );
}
