import { useState } from 'react';
import Link from 'next/link';
import { Col, Button, Row, Skeleton, Typography, Divider, Tag } from 'antd';
import styled from 'styled-components';
import { Path } from '@/utils/enum';
import CheckCircleFilled from '@ant-design/icons/CheckCircleFilled';
import ShareAltOutlined from '@ant-design/icons/ShareAltOutlined';
import QuestionCircleOutlined from '@ant-design/icons/QuestionCircleOutlined';
import SaveOutlined from '@ant-design/icons/SaveOutlined';
import FileDoneOutlined from '@ant-design/icons/FileDoneOutlined';
import StepContent from '@/components/pages/home/thread/StepContent';
import FeedbackLayout from '@/components/pages/home/thread/feedback';
import {
  AskingTaskStatus,
  ThreadResponse,
} from '@/apollo/client/graphql/__types__';
import { makeIterable } from '@/utils/iteration';
import { getReferenceIcon } from '@/components/pages/home/thread/feedback/utils';

const { Title, Text } = Typography;

const Wrapper = styled.div`
  width: 680px;
  flex-shrink: 0;
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

const CorrectionTemplate = ({ id, type, correction }) => {
  return (
    <div className="my-1 gray-7">
      <Tag className="ant-tag__reference bg-gray-7 gray-1">
        <span className="mr-1 lh-xs">{getReferenceIcon(type)}</span>
        {id}
      </Tag>
      {correction}
    </div>
  );
};
const CorrectionIterator = makeIterable(CorrectionTemplate);
const RegenerateInformation = (props: ThreadResponse) => {
  const { question, corrections } = props;
  const [collapse, setCollapse] = useState(false);
  const collapseText = collapse ? 'Hide' : 'Show';
  return (
    <div className="rounded bg-gray-3 gray-6 py-2 px-3 mb-2">
      <div className="d-flex align-center gx-2">
        <ShareAltOutlined />
        <div className="flex-grow-1">Regenerated answer from</div>
        <span
          className="select-none cursor-pointer hover:underline"
          onClick={() => setCollapse(!collapse)}
        >
          {collapseText} feedbacks
        </span>
      </div>
      <Text className="gray-6 text-medium" ellipsis={!collapse}>
        {question}
      </Text>
      {collapse && (
        <div>
          <Divider className="mt-3 mb-1" />
          <div className="d-flex align-center gx-2">
            <ShareAltOutlined />
            <div>Feedbacks</div>
          </div>
          <CorrectionIterator data={corrections} />
        </div>
      )}
    </div>
  );
};

const QuestionInformation = (props) => {
  const { question } = props;
  const [ellipsis, setEllipsis] = useState(true);
  return (
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
  );
};

export default function AnswerResult(props: Props) {
  const {
    threadResponse,
    isLastThreadResponse,
    onOpenSaveAsViewModal,
    onTriggerScrollToBottom,
    onSubmitReviewDrawer,
  } = props;

  const { id: responseId, summary, status, corrections } = threadResponse;
  const {
    view,
    steps,
    description,
    sql: fullSql,
  } = threadResponse?.detail || {};

  const isViewSaved = !!view;
  const isRegenerated = !!corrections;
  const loading = status !== AskingTaskStatus.FINISHED;

  const Information = isRegenerated
    ? RegenerateInformation
    : QuestionInformation;

  return (
    <Skeleton active loading={loading}>
      <FeedbackLayout
        headerSlot={
          <Wrapper>
            <Information {...threadResponse} />
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
