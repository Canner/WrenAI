import clsx from 'clsx';
import { Alert, Skeleton } from 'antd';
import styled from 'styled-components';
import { getIsFinished } from '@/hooks/useAskPrompt';
import { Props as AnswerResultProps } from '@/components/pages/home/promptThread/AnswerResult';
import StepContent from '@/components/pages/home/promptThread/StepContent';

const StyledSkeleton = styled(Skeleton)`
  padding: 16px;
  .ant-skeleton-paragraph {
    margin-bottom: 0;
  }
`;

export default function BreakdownAnswer(
  props: Pick<
    AnswerResultProps,
    'motion' | 'threadResponse' | 'isLastThreadResponse' | 'onInitPreviewDone'
  >,
) {
  const { isLastThreadResponse, motion, onInitPreviewDone, threadResponse } =
    props;

  const { id, sql } = threadResponse;
  const { description, error, status, steps } =
    threadResponse?.breakdownDetail || {};

  const loading = !getIsFinished(status);

  if (error) {
    return (
      <Alert
        className="m-4"
        message={error.shortMessage}
        description={error.message}
        type="error"
        showIcon
      />
    );
  }

  return (
    <StyledSkeleton
      active
      loading={loading}
      paragraph={{ rows: 4 }}
      title={false}
    >
      <div className={clsx({ 'promptThread-answer': motion })}>
        <div className="text-md gray-10 p-3 pr-10 pt-6">
          <div className="pl-7 pb-5">{description}</div>
          {(steps || []).map((step, index) => (
            <StepContent
              isLastStep={index === steps.length - 1}
              key={`${step.summary}-${index}`}
              sql={step.sql}
              fullSql={sql}
              stepIndex={index}
              summary={step.summary}
              threadResponseId={id}
              onInitPreviewDone={onInitPreviewDone}
              isLastThreadResponse={isLastThreadResponse}
            />
          ))}
        </div>
      </div>
    </StyledSkeleton>
  );
}
