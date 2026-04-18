import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Divider } from 'antd';
import styled from 'styled-components';
import { nextTick } from '@/utils/time';
import { usePromptThreadDataStore } from './store';
import AnswerResult from './AnswerResult';
import { makeIterable, IterableComponent } from '@/utils/iteration';
import { getIsFinished } from '@/hooks/useAskPrompt';
import { getAnswerIsFinished } from '@/components/pages/home/promptThread/answerGeneration';
import type { RecommendedQuestionsTask, ThreadResponse } from '@/types/home';

import { SelectQuestionProps } from '@/components/pages/home/RecommendedQuestions';
import { resolveShouldAutoPreviewThreadResponse } from './autoPreview';
const THREAD_INITIAL_VISIBLE_RESPONSE_COUNT = 24;
const THREAD_VISIBLE_RESPONSE_BATCH = 24;

export interface RecommendedQuestionsProps {
  data: RecommendedQuestionsTask;
  show: boolean;
  onSelect: ({ question, sql }: SelectQuestionProps) => void;
}

const StyledPromptThread = styled.div`
  width: 100%;
  max-width: 100%;
  margin-left: auto;
  margin-right: auto;

  h4.ant-typography {
    margin-top: 10px;
  }

  .ant-typography pre {
    border: none;
    border-radius: 4px;
  }

  button {
    vertical-align: middle;
  }
`;

const ThreadLoadMoreButton = styled.button`
  width: 100%;
  border: 1px dashed #d9e0ea;
  border-radius: 10px;
  height: 36px;
  background: #f9fbfd;
  color: #6b7280;
  font-size: 13px;
  cursor: pointer;
  margin-bottom: 12px;

  &:hover {
    border-color: #c6d0de;
    color: #4b5563;
    background: #f4f7fb;
  }
`;

const AnswerResultTemplate: React.FC<
  IterableComponent<ThreadResponse> & {
    motion: boolean;
    onInitPreviewDone: () => void;
    initialBlockedPreviewResponseId: number | null;
  }
> = ({
  data,
  index,
  motion,
  onInitPreviewDone,
  initialBlockedPreviewResponseId,
  ...threadResponse
}) => {
  const { id } = threadResponse;
  const lastResponseId = data[data.length - 1].id;
  const isLastThreadResponse = id === lastResponseId;
  const shouldAutoPreview = resolveShouldAutoPreviewThreadResponse({
    responseId: id,
    isLastThreadResponse,
    initialBlockedPreviewResponseId,
  });

  return (
    <div
      key={`${id}-${index}`}
      data-guideid={isLastThreadResponse ? `last-answer-result` : undefined}
    >
      {index > 0 && <Divider />}
      <AnswerResult
        motion={motion}
        isOpeningQuestion={index === 0}
        isLastThreadResponse={isLastThreadResponse}
        shouldAutoPreview={shouldAutoPreview}
        onInitPreviewDone={onInitPreviewDone}
        threadResponse={threadResponse}
      />
    </div>
  );
};

const AnswerResultIterator = makeIterable(AnswerResultTemplate);

export default function PromptThread() {
  const router = useRouter();
  const divRef = useRef<HTMLDivElement>(null);
  const initialBlockedPreviewResponseIdRef = useRef<number | null>(null);
  const previousResponsesLengthRef = useRef(0);
  const { data } = usePromptThreadDataStore();
  const [visibleResponseCount, setVisibleResponseCount] = useState(
    THREAD_INITIAL_VISIBLE_RESPONSE_COUNT,
  );

  const responses = useMemo(() => data?.responses || [], [data?.responses]);
  const hiddenResponseCount = Math.max(
    0,
    responses.length - visibleResponseCount,
  );
  const visibleResponses = useMemo(
    () => responses.slice(hiddenResponseCount),
    [hiddenResponseCount, responses],
  );

  useEffect(() => {
    initialBlockedPreviewResponseIdRef.current = null;
    previousResponsesLengthRef.current = 0;
    setVisibleResponseCount(THREAD_INITIAL_VISIBLE_RESPONSE_COUNT);
  }, [router.query.id]);

  useEffect(() => {
    const previousLength = previousResponsesLengthRef.current;
    const currentLength = responses.length;

    if (currentLength === 0) {
      previousResponsesLengthRef.current = 0;
      return;
    }

    if (currentLength < previousLength) {
      setVisibleResponseCount(THREAD_INITIAL_VISIBLE_RESPONSE_COUNT);
    } else if (previousLength === 0) {
      setVisibleResponseCount(
        Math.min(currentLength, THREAD_INITIAL_VISIBLE_RESPONSE_COUNT),
      );
    } else if (currentLength > previousLength) {
      const delta = currentLength - previousLength;
      setVisibleResponseCount((currentVisibleCount) =>
        Math.min(currentLength, currentVisibleCount + delta),
      );
    }

    previousResponsesLengthRef.current = currentLength;
  }, [responses.length]);

  useEffect(() => {
    if (initialBlockedPreviewResponseIdRef.current != null) {
      return;
    }

    const initialLastResponse = responses[responses.length - 1];
    if (!initialLastResponse?.id) {
      return;
    }

    initialBlockedPreviewResponseIdRef.current = initialLastResponse.id;
  }, [responses]);

  const initialBlockedPreviewResponseId =
    initialBlockedPreviewResponseIdRef.current ??
    responses[responses.length - 1]?.id ??
    null;

  const triggerScrollToBottom = (behavior?: ScrollBehavior) => {
    if (responses.length <= 1) return;
    const contentLayout = divRef.current?.parentElement;
    const allElements = (divRef.current?.querySelectorAll(
      '[data-jsid="answerResult"]',
    ) || []) as HTMLElement[];
    const lastAnswerResult = allElements[allElements.length - 1];

    const dividerSpace = 48;
    if (contentLayout && lastAnswerResult) {
      contentLayout.scrollTo({
        top: lastAnswerResult.offsetTop - dividerSpace,
        behavior,
      });
    }
  };

  useEffect(() => {
    // reset to top when thread page changes
    const contentLayout = divRef.current?.parentElement;
    if (contentLayout) contentLayout.scrollTo({ top: 0 });
  }, [router.query]);

  useEffect(() => {
    const lastResponse = responses[responses.length - 1];
    const isLastResponseFinished =
      getIsFinished(lastResponse?.askingTask?.status) ||
      getAnswerIsFinished(lastResponse?.answerDetail?.status);
    nextTick().then(() => {
      triggerScrollToBottom(isLastResponseFinished ? 'auto' : 'smooth');
    });
  }, [responses.length]);

  const onInitPreviewDone = () => {
    triggerScrollToBottom();
  };
  const handleLoadMoreResponses = useCallback(() => {
    setVisibleResponseCount((currentVisibleCount) =>
      Math.min(
        responses.length,
        currentVisibleCount + THREAD_VISIBLE_RESPONSE_BATCH,
      ),
    );
  }, [responses.length]);

  return (
    <StyledPromptThread className="mt-12" ref={divRef}>
      {hiddenResponseCount > 0 ? (
        <ThreadLoadMoreButton type="button" onClick={handleLoadMoreResponses}>
          加载更早对话（{hiddenResponseCount} 条）
        </ThreadLoadMoreButton>
      ) : null}
      <AnswerResultIterator
        data={visibleResponses}
        initialBlockedPreviewResponseId={initialBlockedPreviewResponseId}
        onInitPreviewDone={onInitPreviewDone}
      />
    </StyledPromptThread>
  );
}
