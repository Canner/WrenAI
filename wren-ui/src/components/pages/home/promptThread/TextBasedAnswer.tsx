import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Skeleton, Typography, message } from 'antd';
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
import { ThreadResponseAnswerStatus } from '@/apollo/client/graphql/__types__';
import useResponsePreviewData from '@/hooks/useResponsePreviewData';

const { Text } = Typography;

const StyledSkeleton = styled(Skeleton)`
  padding: 16px;
  .ant-skeleton-paragraph {
    margin-bottom: 0;
  }
`;

export const getAnswerIsFinished = (
  status?: ThreadResponseAnswerStatus | null,
) =>
  status != null &&
  [
    ThreadResponseAnswerStatus.FINISHED,
    ThreadResponseAnswerStatus.FAILED,
    ThreadResponseAnswerStatus.INTERRUPTED,
  ].includes(status);

const getIsLoadingFinished = (status?: ThreadResponseAnswerStatus | null) =>
  getAnswerIsFinished(status) ||
  status === ThreadResponseAnswerStatus.STREAMING;

export default function TextBasedAnswer(props: AnswerResultProps) {
  const {
    onGenerateTextBasedAnswer,
    onOpenAdjustReasoningStepsModal,
    onOpenAdjustSQLModal,
  } = usePromptThreadStore();
  const {
    isLastThreadResponse,
    onInitPreviewDone,
    shouldAutoPreview,
    threadResponse,
  } = props;
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
      sql: threadResponse.sql || '',
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
      setTextAnswer(answerStreamTask || '');
    } else {
      setTextAnswer(content || '');
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

  useEffect(() => {
    setIsPreviewExpanded(false);
  }, [id]);

  const rowsUsed = useMemo(
    () =>
      status === ThreadResponseAnswerStatus.FINISHED
        ? numRowsUsedInLLM || 0
        : 0,
    [numRowsUsedInLLM, status],
  );

  const allowPreviewData = useMemo(() => Boolean(rowsUsed > 0), [rowsUsed]);

  const previewDataResult = useResponsePreviewData(id);
  const { ensureLoaded: ensurePreviewLoaded } = previewDataResult;
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(false);
  const hasPreviewData = !!previewDataResult.data?.previewData;

  const fetchPreviewData = async () => {
    await ensurePreviewLoaded();
  };

  const onPreviewData = async () => {
    const nextExpanded = !isPreviewExpanded;
    setIsPreviewExpanded(nextExpanded);
    if (!nextExpanded) return;

    if (!previewDataResult.called && !previewDataResult.loading) {
      await fetchPreviewData();
    }
  };

  const autoTriggerPreviewDataButton = async () => {
    setIsPreviewExpanded(true);
    await nextTick();
    await fetchPreviewData();
  };

  useEffect(() => {
    if (isLastThreadResponse) {
      if (allowPreviewData) {
        if (shouldAutoPreview) {
          autoTriggerPreviewDataButton();
        }
      }

      onInitPreviewDone();
    }
  }, [isLastThreadResponse, allowPreviewData, shouldAutoPreview]);

  const loading = !getIsLoadingFinished(status);

  const onRegenerateAnswer = () => {
    setTextAnswer('');
    onGenerateTextBasedAnswer(id);
  };

  const onMoreClick = async (
    payload: MORE_ACTION | { type: MORE_ACTION; data: any },
  ) => {
    const type =
      typeof payload === 'object' && payload !== null ? payload.type : payload;
    const data =
      typeof payload === 'object' && payload !== null && payload.data
        ? payload.data
        : adjustAnswerDropdownData;
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
        调整回答
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
              title="重新生成回答"
              onClick={onRegenerateAnswer}
            >
              重新生成
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
              查看结果
            </Button>

            {isPreviewExpanded && (
              <div
                className="mt-2 mb-3"
                data-guideid="text-answer-preview-data"
              >
                {hasPreviewData && (
                  <Text type="secondary" className="text-sm">
                    受上下文窗口限制，系统最多会提取 500 行结果来生成本次回答。
                  </Text>
                )}
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
                    点击 <b>SQL 查询</b>{' '}
                    查看逐步生成的查询逻辑，并确认当前为何暂无数据。
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
