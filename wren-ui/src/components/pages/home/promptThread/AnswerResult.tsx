import { Button, Skeleton, Typography } from 'antd';
import styled from 'styled-components';
import CheckCircleFilled from '@ant-design/icons/CheckCircleFilled';
import SaveOutlined from '@ant-design/icons/SaveOutlined';
import StepContent from '@/components/pages/home/promptThread/StepContent';

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

interface Props {
  loading: boolean;
  question: string;
  description: string;
  answerResultSteps: Array<{
    summary: string;
    sql: string;
  }>;
  fullSql: string;
  threadResponseId: number;
  onOpenSaveAsViewModal: (data: { sql: string; responseId: number }) => void;
}

export default function AnswerResult(props: Props) {
  const {
    loading,
    question,
    description,
    answerResultSteps,
    fullSql,
    threadResponseId,
    onOpenSaveAsViewModal,
  } = props;

  return (
    <Skeleton active loading={loading}>
      <Title className="mb-6 text-bold gray-10" level={3}>
        {question}
      </Title>
      <StyledAnswer className="text-md gray-10 p-3 pr-10 pt-6">
        <Text className="adm-answer-title px-2">
          <CheckCircleFilled className="mr-2 green-6" />
          Summary
        </Text>
        <div className="pl-7 pb-5">{description}</div>
        {(answerResultSteps || []).map((step, index) => (
          <StepContent
            isLastStep={index === answerResultSteps.length - 1}
            key={`${step.summary}-${index}`}
            sql={step.sql}
            fullSql={fullSql}
            stepIndex={index}
            summary={step.summary}
            threadResponseId={threadResponseId}
          />
        ))}
      </StyledAnswer>
      <Button
        className="mt-2 gray-6"
        type="text"
        size="small"
        icon={<SaveOutlined />}
        onClick={() =>
          onOpenSaveAsViewModal({ sql: fullSql, responseId: threadResponseId })
        }
      >
        Save as View
      </Button>
    </Skeleton>
  );
}
