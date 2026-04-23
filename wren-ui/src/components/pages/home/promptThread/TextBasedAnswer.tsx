import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Skeleton, Typography } from 'antd';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import LoadingOutlined from '@ant-design/icons/LoadingOutlined';
import styled from 'styled-components';
import { BinocularsIcon } from '@/utils/icons';
import { nextTick } from '@/utils/time';
import { usePromptThreadActionsStore } from './store';
import useTextBasedAnswerStreamTask from '@/hooks/useTextBasedAnswerStreamTask';
import { Props as AnswerResultProps } from '@/components/pages/home/promptThread/AnswerResult';
import MarkdownBlock from '@/components/editor/MarkdownBlock';
import PreviewData from '@/components/dataPreview/PreviewData';
import { ThreadResponseAnswerStatus } from '@/types/home';

import useResponsePreviewData from '@/hooks/useResponsePreviewData';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';
import { getAnswerIsFinished } from './answerGeneration';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { resolveThreadResponseRuntimeSelector } from '@/features/home/thread/threadResponseRuntime';

const { Text } = Typography;

const StyledSkeleton = styled(Skeleton)`
  padding: 0;
  .ant-skeleton-paragraph {
    margin-bottom: 0;
  }
`;

const ResultActionButton = styled(Button)`
  && {
    height: 32px;
    border-radius: 10px;
    padding-inline: 10px;
    font-weight: 500;
  }
`;

const AnswerMarkdownBody = styled.div`
  color: #2b3443;
  line-height: 1.8;
  font-size: 14px;

  > :last-child {
    margin-bottom: 0;
  }
`;

const getIsLoadingFinished = (status?: ThreadResponseAnswerStatus | null) =>
  getAnswerIsFinished(status) ||
  status === ThreadResponseAnswerStatus.STREAMING;

export default function TextBasedAnswer(props: AnswerResultProps) {
  const { onGenerateTextBasedAnswer } = usePromptThreadActionsStore();
  const {
    isLastThreadResponse,
    mode,
    onInitPreviewDone,
    shouldAutoPreview,
    threadResponse,
  } = props;
  const { id } = threadResponse;
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const responseRuntimeSelector = resolveThreadResponseRuntimeSelector({
    response: threadResponse,
    fallbackSelector: runtimeScopeNavigation.selector,
  });
  const { content, error, numRowsUsedInLLM, status } =
    threadResponse?.answerDetail || {};

  const [textAnswer, setTextAnswer] = useState<string>('');

  const [fetchAnswerStreamingTask, answerStreamTaskResult] =
    useTextBasedAnswerStreamTask(responseRuntimeSelector);

  const answerStreamTask = answerStreamTaskResult.data;

  const isStreaming = useMemo(
    () => status === ThreadResponseAnswerStatus.STREAMING,
    [status],
  );

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
  const allowInlinePreview = mode === 'workbench';

  const previewDataResult = useResponsePreviewData(id, responseRuntimeSelector);
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
      if (allowPreviewData && allowInlinePreview) {
        if (shouldAutoPreview) {
          autoTriggerPreviewDataButton();
        }
      }

      onInitPreviewDone();
    }
  }, [
    allowInlinePreview,
    isLastThreadResponse,
    allowPreviewData,
    shouldAutoPreview,
  ]);

  const loading = !getIsLoadingFinished(status);

  const onRegenerateAnswer = () => {
    setTextAnswer('');
    onGenerateTextBasedAnswer(id);
  };

  const answerErrorMessage = resolveAbortSafeErrorMessage(
    error?.message,
    '回答生成失败，请稍后重试。',
  );
  const answerShortMessage =
    resolveAbortSafeErrorMessage(
      error?.shortMessage,
      answerErrorMessage || '',
    ) || '回答生成失败';

  if (error && answerErrorMessage) {
    return (
      <>
        <div className="pt-0 pb-2">
          <Alert
            className="mt-2 mb-2"
            message={answerShortMessage}
            description={answerErrorMessage}
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
      <div className="text-md gray-10 pt-0 pb-2">
        <AnswerMarkdownBody>
          <MarkdownBlock content={textAnswer} />
        </AnswerMarkdownBody>
        {isStreaming && <LoadingOutlined className="geekblue-6" spin />}
        {status === ThreadResponseAnswerStatus.INTERRUPTED && (
          <div className="mt-2 text-right">
            <ResultActionButton
              icon={<ReloadOutlined />}
              size="small"
              type="link"
              title="重新生成回答"
              onClick={onRegenerateAnswer}
            >
              重新生成
            </ResultActionButton>
          </div>
        )}
        {allowPreviewData && allowInlinePreview ? (
          <div className="mt-6">
            <ResultActionButton
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
            </ResultActionButton>

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
        ) : allowInlinePreview ? (
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
        ) : null}
      </div>
    </StyledSkeleton>
  );
}
