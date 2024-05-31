import { useState } from 'react';
import Link from 'next/link';
import { Col, Button, Row, Skeleton, Typography } from 'antd';
import styled from 'styled-components';
import { Path } from '@/utils/enum';
import CheckCircleFilled from '@ant-design/icons/CheckCircleFilled';
import QuestionCircleOutlined from '@ant-design/icons/QuestionCircleOutlined';
import SaveOutlined from '@ant-design/icons/SaveOutlined';
import FileDoneOutlined from '@ant-design/icons/FileDoneOutlined';
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

const StyledQuestion = styled(Row)`
  padding: 4px 8px;
  border-radius: 4px;
  color: var(--gray-6);
  background-color: var(--gray-3);
  margin-bottom: 8px;
  font-size: 14px;

  &:hover {
    background-color: var(--gray-4) !important;
    cursor: pointer;
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
  isLastThreadResponse: boolean;
  onTriggerScrollToBottom: () => void;
  summary: string;
  view?: {
    id: number;
    displayName: string;
  };
}

export default function AnswerResult(props: Props) {
  const {
    loading,
    question,
    description,
    answerResultSteps,
    fullSql,
    threadResponseId,
    isLastThreadResponse,
    onOpenSaveAsViewModal,
    onTriggerScrollToBottom,
    summary,
    view,
  } = props;

  const isViewSaved = !!view;

  const [ellipsis, setEllipsis] = useState(true);

  return (
    <Skeleton active loading={loading}>
      <StyledQuestion wrap={false} onClick={() => setEllipsis(!ellipsis)}>
        <Col className="text-center" flex="96px">
          <QuestionCircleOutlined className="mr-2 gray-6" />
          <Text className="gray-6 text-base text-medium">Question:</Text>
        </Col>
        <Col flex="auto">
          <Text className="gray-6" ellipsis={ellipsis}>
            {question}
          </Text>
        </Col>
      </StyledQuestion>
      <Title className="mb-6 text-bold gray-10" level={3}>
        {summary}
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
            onTriggerScrollToBottom={onTriggerScrollToBottom}
            isLastThreadResponse={isLastThreadResponse}
          />
        ))}
      </StyledAnswer>
      {isViewSaved ? (
        <div className="mt-2 gray-6 text-medium">
          <FileDoneOutlined className="mr-2" />
          Generated from saved view{' '}
          <Link
            className="gray-7"
            href={`${Path.Modeling}?viewId=${view.id}&openMetadata=true`}
            target="_blank"
            rel="noreferrer noopener"
          >
            {view.displayName}
          </Link>
        </div>
      ) : (
        <Button
          className="mt-2 gray-6"
          type="text"
          size="small"
          icon={<SaveOutlined />}
          onClick={() =>
            onOpenSaveAsViewModal({
              sql: fullSql,
              responseId: threadResponseId,
            })
          }
        >
          Save as View
        </Button>
      )}
    </Skeleton>
  );
}
