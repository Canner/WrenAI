import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Skeleton, Typography } from 'antd';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import LoadingOutlined from '@ant-design/icons/LoadingOutlined';
import CaretDownOutlined from '@ant-design/icons/CaretDownOutlined';
import EditOutlined from '@ant-design/icons/EditOutlined';
import styled from 'styled-components';
import { BinocularsIcon } from '@/utils/icons';
import { nextTick } from '@/utils/time';
import { MORE_ACTION } from '@/utils/enum';
import usePromptThreadStore from './store';
import useDropdown from '@/hooks/useDropdown';
import useTextBasedAnswerStreamTask from '@/hooks/useTextBasedAnswerStreamTask';
import { Props as AnswerResultProps } from '@/components/pages/home/promptThread/AnswerResult';
import MarkdownBlock from '@/components/editor/MarkdownBlock';
import PreviewData from '@/components/dataPreview/PreviewData';
import { AdjustAnswerDropdown } from '@/components/diagram/CustomDropdown';
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

export default function TextBasedAnswer(props: AnswerResultProps) {
  const {
    onGenerateTextBasedAnswer,
    onOpenAdjustReasoningStepsModal,
    onOpenAdjustSQLModal,
  } = usePromptThreadStore();
  const { isLastThreadResponse, onInitPreviewDone, threadResponse } = props;
  const { id } = threadResponse;
  const { content, error, numRowsUsedInLLM, status } =
    threadResponse?.answerDetail || {};

  const [textAnswer, setTextAnswer] = useState<string>('');
  const adjustResultsDropdown = useDropdown();

  const [fetchAnswerStreamingTask, answerStreamTaskResult] =
    useTextBasedAnswerStreamTask();

  const answerStreamTask = answerStreamTaskResult.data;

  const isStreaming = useMemo(
    () => status === ThreadResponseAnswerStatus.STREAMING,
    [status],
  );

  // Adapt askingTask and adjustment reasoning data to dropdown
  const adjustAnswerDropdownData = useMemo(() => {
    const { payload } = threadResponse.adjustment || {};
    return {
      responseId: threadResponse.id,
      sql: threadResponse.sql,
      retrievedTables:
        threadResponse.askingTask?.retrievedTables ||
        payload?.retrievedTables ||
        [],
      sqlGenerationReasoning:
        threadResponse.askingTask?.sqlGenerationReasoning ||
        payload?.sqlGenerationReasoning ||
        '',
    };
  }, [
    threadResponse.id,
    threadResponse.sql,
    threadResponse.adjustment?.payload,
    threadResponse.askingTask?.retrievedTables,
    threadResponse.askingTask?.sqlGenerationReasoning,
  ]);

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
  const hasPreviewData = !!previewDataResult.data?.previewData;

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
    onGenerateTextBasedAnswer(id);
  };

  const onMoreClick = async (payload: {
    type: MORE_ACTION;
    data: typeof adjustAnswerDropdownData;
  }) => {
    const { type, data } = payload;
    if (type === MORE_ACTION.ADJUST_STEPS) {
      onOpenAdjustReasoningStepsModal({
        responseId: data.responseId,
        retrievedTables: data.retrievedTables,
        sqlGenerationReasoning: data.sqlGenerationReasoning,
      });
    } else if (type === MORE_ACTION.ADJUST_SQL) {
      onOpenAdjustSQLModal({ responseId: id, sql: data.sql });
    }
  };

  const adjustAnswerDropdown = (
    <AdjustAnswerDropdown
      onMoreClick={onMoreClick}
      data={adjustAnswerDropdownData}
      onDropdownVisibleChange={adjustResultsDropdown.onVisibleChange}
    >
      <Button
        className="px-0"
        type="link"
        size="small"
        icon={<EditOutlined />}
        onClick={(event) => event.stopPropagation()}
      >
        Adjust the answer
        <CaretDownOutlined
          className="ml-1"
          rotate={adjustResultsDropdown.visible ? 180 : 0}
        />
      </Button>
    </AdjustAnswerDropdown>
  );

  if (error) {
    return (
      <>
        <div className="py-4 px-6">
          <div className="text-right">{adjustAnswerDropdown}</div>
          <Alert
            className="mt-4 mb-2"
            message={error.shortMessage}
            description={error.message}
            type="error"
            showIcon
          />
        </div>
      </>
    );
  }

  return (
    <StyledSkeleton
      active
      loading={loading}
      paragraph={{ rows: 4 }}
      title={false}
    >
      <div className="text-md gray-10 py-4 px-6">
        <div className="text-right mb-4">{adjustAnswerDropdown}</div>
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

            <div className="mt-2 mb-3" data-guideid="text-answer-preview-data">
              {hasPreviewData && (
                <Text type="secondary" className="text-sm">
                  Considering the limit of the context window, we retrieve up to
                  500 rows of results to generate the answer.
                </Text>
              )}
              <PreviewData
                error={previewDataResult.error}
                loading={previewDataResult.loading}
                previewData={previewDataResult?.data?.previewData}
              />
            </div>
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
