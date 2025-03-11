import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Skeleton, Typography } from 'antd';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import LoadingOutlined from '@ant-design/icons/LoadingOutlined';
import styled from 'styled-components';
import { BinocularsIcon } from '@/utils/icons';
import { nextTick } from '@/utils/time';
import useTextBasedAnswerStreamTask from '@/hooks/useTextBasedAnswerStreamTask';
import { Props as AnswerResultProps } from '@/components/pages/home/promptThread/AnswerResult';
import MarkdownBlock from '@/components/editor/MarkdownBlock';
import PreviewData from '@/components/dataPreview/PreviewData';
import { usePreviewDataMutation } from '@/apollo/client/graphql/home.generated';
import { ThreadResponseAnswerStatus } from '@/apollo/client/graphql/__types__';

const { Text } = Typography;

const StyledSkeleton = styled(Skeleton)`
  padding: 16px;
  .ant-skeleton-paragraph {
    margin-bottom: 0;
  }
`;

export const getAnswerIsFinished = (status: ThreadResponseAnswerStatus) =>
  [
    ThreadResponseAnswerStatus.FINISHED,
    ThreadResponseAnswerStatus.FAILED,
    ThreadResponseAnswerStatus.INTERRUPTED,
  ].includes(status);

const getIsLoadingFinished = (status: ThreadResponseAnswerStatus) =>
  getAnswerIsFinished(status) ||
  status === ThreadResponseAnswerStatus.STREAMING;

export default function TextBasedAnswer(
  props: Pick<
    AnswerResultProps,
    | 'threadResponse'
    | 'isLastThreadResponse'
    | 'onInitPreviewDone'
    | 'onRegenerateTextBasedAnswer'
  >,
) {
  const {
    isLastThreadResponse,
    onInitPreviewDone,
    onRegenerateTextBasedAnswer,
    threadResponse,
  } = props;
  const { id } = threadResponse;
  const { content, error, numRowsUsedInLLM, status } =
    threadResponse?.answerDetail || {};

  const [textAnswer, setTextAnswer] = useState<string>('');

  const [fetchAnswerStreamingTask, answerStreamTaskResult] =
    useTextBasedAnswerStreamTask();

  const answerStreamTask = answerStreamTaskResult.data;

  const isStreaming = useMemo(
    () => status === ThreadResponseAnswerStatus.STREAMING,
    [status],
  );

  useEffect(() => {
    if (isStreaming) {
      setTextAnswer(answerStreamTask);
    } else {
      setTextAnswer(content);
    }
  }, [answerStreamTask, isStreaming, content]);

  useEffect(() => {
    if (isStreaming) {
      fetchAnswerStreamingTask(id);
    }
  }, [isStreaming, id]);

  useEffect(() => {
    return () => {
      answerStreamTaskResult.onReset();
    };
  }, []);

  const rowsUsed = useMemo(
    () =>
      status === ThreadResponseAnswerStatus.FINISHED ? numRowsUsedInLLM : 0,
    [numRowsUsedInLLM, status],
  );

  const allowPreviewData = useMemo(() => Boolean(rowsUsed > 0), [rowsUsed]);

  const [previewData, previewDataResult] = usePreviewDataMutation({
    onError: (error) => console.error(error),
  });

  const onPreviewData = async () => {
    await previewData({ variables: { where: { responseId: id } } });
  };

  const autoTriggerPreviewDataButton = async () => {
    await nextTick();
    await onPreviewData();
  };

  useEffect(() => {
    if (isLastThreadResponse) {
      if (allowPreviewData) {
        autoTriggerPreviewDataButton();
      }

      onInitPreviewDone();
    }
  }, [isLastThreadResponse, allowPreviewData]);

  const loading = !getIsLoadingFinished(status);

  const onRegenerateAnswer = () => {
    setTextAnswer('');
    onRegenerateTextBasedAnswer(id);
  };

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
      <div className="text-md gray-10 p-4 pr-6">
        <MarkdownBlock content={textAnswer} />
        {isStreaming && <LoadingOutlined className="geekblue-6" spin />}
        {status === ThreadResponseAnswerStatus.INTERRUPTED && (
          <div className="mt-2 text-right">
            <Button
              icon={<ReloadOutlined />}
              size="small"
              type="link"
              title="Regenerate answer"
              onClick={onRegenerateAnswer}
            >
              Regenerate
            </Button>
          </div>
        )}
        {allowPreviewData ? (
          <div className="mt-6">
            <Button
              size="small"
              icon={
                <BinocularsIcon
                  style={{
                    paddingBottom: 2,
                    marginRight: 8,
                  }}
                />
              }
              loading={previewDataResult.loading}
              onClick={onPreviewData}
              data-ph-capture="true"
              data-ph-capture-attribute-name="cta_text-answer_preview_data"
            >
              View results
            </Button>

            {previewDataResult?.data?.previewData && (
              <div
                className="mt-2 mb-3"
                data-guideid="text-answer-preview-data"
              >
                <Text type="secondary" className="text-sm">
                  Considering the limit of the context window, we retrieve up to
                  500 rows of results to generate the answer.
                </Text>
                <PreviewData
                  error={previewDataResult.error}
                  loading={previewDataResult.loading}
                  previewData={previewDataResult?.data?.previewData}
                />
              </div>
            )}
          </div>
        ) : (
          <>
            {!isStreaming && (
              <Alert
                message={
                  <>
                    Click <b>View SQL</b> to review the step-by-step query logic
                    and verify why the data is unavailable.
                  </>
                }
                type="info"
              />
            )}
          </>
        )}
      </div>
    </StyledSkeleton>
  );
}
