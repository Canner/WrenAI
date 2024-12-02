import clsx from 'clsx';
import { Skeleton, Typography, Alert } from 'antd';
import styled from 'styled-components';
import CheckCircleFilled from '@ant-design/icons/CheckCircleFilled';
import MessageOutlined from '@ant-design/icons/MessageOutlined';
import StepContent from '@/components/pages/home/promptThread/StepContent';
import { getIsFinished } from '@/hooks/useAskPrompt';
import { RecommendedQuestionsProps } from '@/components/pages/home/promptThread';
import RecommendedQuestions, {
  getRecommendedQuestionProps,
} from '@/components/pages/home/RecommendedQuestions';
import ViewBlock from '@/components/pages/home/promptThread/ViewBlock';
import { ThreadResponse } from '@/apollo/client/graphql/__types__';

const { Title, Text } = Typography;

const StyledAnswer = styled(Typography)`
  position: relative;
  border: 1px var(--gray-4) solid;
  border-radius: 4px;

  .adm-answer-title {
    font-weight: 500;
    position: absolute;
    top: -13px;
    left: 8px;
    background: white;
  }
`;

const StyledSkeleton = styled(Skeleton)`
  .ant-skeleton-title {
    margin-top: 0;
  }
`;

interface Props {
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

  const { question, status, error } = threadResponse;

  const { steps, description, view, sql } = threadResponse?.detail || {};

  const loading = !getIsFinished(status);

  const resultStyle = isLastThreadResponse
    ? { minHeight: 'calc(100vh - (194px))' }
    : null;

  const recommendedQuestionProps = getRecommendedQuestionProps(
    recommendedQuestionsProps.data,
    recommendedQuestionsProps.show,
  );

  return (
    <div style={resultStyle} className="adm-answer-result">
      <QuestionTitle className="mb-9" question={question} />
      {error ? (
        <>
          <Alert
            message={error.shortMessage}
            description={error.message}
            type="error"
            showIcon
          />
          {renderRecommendedQuestions(
            isLastThreadResponse,
            recommendedQuestionProps,
            recommendedQuestionsProps.onSelect,
          )}
        </>
      ) : (
        <StyledSkeleton active loading={loading}>
          <div className={clsx({ 'promptThread-answer': motion })}>
            <StyledAnswer className="text-md gray-10 p-3 pr-10 pt-6">
              <Text className="adm-answer-title px-2">
                <CheckCircleFilled className="mr-2 green-6" />
                Summary
              </Text>
              <div className="pl-7 pb-5">{description}</div>
              {(steps || []).map((step, index) => (
                <StepContent
                  isLastStep={index === steps.length - 1}
                  key={`${step.summary}-${index}`}
                  sql={step.sql}
                  fullSql={sql}
                  stepIndex={index}
                  summary={step.summary}
                  threadResponseId={threadResponse.id}
                  onInitPreviewDone={onInitPreviewDone}
                  isLastThreadResponse={isLastThreadResponse}
                />
              ))}
            </StyledAnswer>
            <ViewBlock
              view={view}
              onClick={() =>
                onOpenSaveAsViewModal({
                  sql,
                  responseId: threadResponse.id,
                })
              }
            />
            {renderRecommendedQuestions(
              isLastThreadResponse,
              recommendedQuestionProps,
              recommendedQuestionsProps.onSelect,
            )}
          </div>
        </StyledSkeleton>
      )}
    </div>
  );
}
