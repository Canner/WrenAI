import { useState } from 'react';
import Link from 'next/link';
import { Col, Button, Row, Skeleton, Typography } from 'antd';
import styled from 'styled-components';
import { Path } from '@/utils/enum';
import CheckCircleFilled from '@ant-design/icons/CheckCircleFilled';
import QuestionCircleOutlined from '@ant-design/icons/QuestionCircleOutlined';
import SaveOutlined from '@ant-design/icons/SaveOutlined';
import FileDoneOutlined from '@ant-design/icons/FileDoneOutlined';
import StepContent from '@/components/pages/home/thread/StepContent';
import FeedbackLayout from '@/components/pages/home/thread/feedback';
import {
  AskingTaskStatus,
  ThreadResponse,
} from '@/apollo/client/graphql/__types__';

const { Title, Text } = Typography;

const Wrapper = styled.div`
  width: 680px;
`;

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
  threadResponse: ThreadResponse;
  isLastThreadResponse: boolean;
  onOpenSaveAsViewModal: (data: { sql: string; responseId: number }) => void;
  onTriggerScrollToBottom: () => void;
  onSubmitReviewDrawer: (variables: any) => Promise<void>;
}

export default function AnswerResult(props: Props) {
  const {
    threadResponse,
    isLastThreadResponse,
    onOpenSaveAsViewModal,
    onTriggerScrollToBottom,
    onSubmitReviewDrawer,
  } = props;

  const { id: responseId, question, summary, status } = threadResponse;
  const {
    view,
    steps,
    description,
    sql: fullSql,
  } = threadResponse?.detail || {};

  const isViewSaved = !!view;
  const loading = status !== AskingTaskStatus.FINISHED;

  const [ellipsis, setEllipsis] = useState(true);

  return (
    <Skeleton active loading={loading}>
      <FeedbackLayout
        headerSlot={
          <Wrapper>
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
          </Wrapper>
        }
        bodySlot={
          <Wrapper>
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
                  fullSql={fullSql}
                  stepIndex={index}
                  summary={step.summary}
                  threadResponseId={responseId}
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
                  onOpenSaveAsViewModal({ sql: fullSql, responseId })
                }
              >
                Save as View
              </Button>
            )}
          </Wrapper>
        }
        threadResponse={threadResponse}
        onSubmitReviewDrawer={onSubmitReviewDrawer}
      />
    </Skeleton>
  );
}
