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
  } = props;

  const { question, error } = threadResponse;

  const { view, sql } = threadResponse?.detail || {};

  const resultStyle = isLastThreadResponse
    ? { minHeight: 'calc(100vh - (194px))' }
    : null;

  const recommendedQuestionProps = getRecommendedQuestionProps(
    recommendedQuestionsProps.data,
    recommendedQuestionsProps.show,
  );

  // TODO: existing thread response doesn't have a text-based answer
  const hasTextBasedAnswer = true;

  return (
    <div style={resultStyle} className="adm-answer-result">
      <QuestionTitle className="mb-6" question={question} />
      <StyledTabs type="card" size="small">
        {hasTextBasedAnswer && (
          <Tabs.TabPane
            key="answer"
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
            />
          </Tabs.TabPane>
        )}
        <Tabs.TabPane
          key="view-sql"
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
      {!error && (
        <ViewBlock
          view={view}
          onClick={() =>
            onOpenSaveAsViewModal({
              sql,
              responseId: threadResponse.id,
            })
          }
        />
      )}
      {renderRecommendedQuestions(
        isLastThreadResponse,
        recommendedQuestionProps,
        recommendedQuestionsProps.onSelect,
      )}
    </div>
  );
}
