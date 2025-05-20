import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef } from 'react';
import { Divider } from 'antd';
import styled from 'styled-components';
import { nextTick } from '@/utils/time';
import usePromptThreadStore from './store';
import AnswerResult from './AnswerResult';
import { makeIterable, IterableComponent } from '@/utils/iteration';
import { getIsFinished } from '@/hooks/useAskPrompt';
import { getAnswerIsFinished } from '@/components/pages/home/promptThread/TextBasedAnswer';
import {
  RecommendedQuestionsTask,
  ThreadResponse,
} from '@/apollo/client/graphql/__types__';
import { SelectQuestionProps } from '@/components/pages/home/RecommendedQuestions';

export interface RecommendedQuestionsProps {
  data: RecommendedQuestionsTask;
  show: boolean;
  onSelect: ({ question, sql }: SelectQuestionProps) => void;
}

const StyledPromptThread = styled.div`
  width: 768px;
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

const AnswerResultTemplate: React.FC<
  IterableComponent<ThreadResponse> & {
    motion: boolean;
    onInitPreviewDone: () => void;
  }
> = ({ data, index, motion, onInitPreviewDone, ...threadResponse }) => {
  const { id } = threadResponse;
  const lastResponseId = data[data.length - 1].id;
  const isLastThreadResponse = id === lastResponseId;

  return (
    <div
      key={`${id}-${index}`}
      data-guideid={isLastThreadResponse ? `last-answer-result` : undefined}
    >
      {index > 0 && <Divider />}
      <AnswerResult
        motion={motion}
        isLastThreadResponse={isLastThreadResponse}
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
  const store = usePromptThreadStore();
  const { data } = store;

  const responses = useMemo(() => data?.responses || [], [data?.responses]);

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

  return (
    <StyledPromptThread className="mt-12" ref={divRef}>
      <AnswerResultIterator
        data={responses}
        onInitPreviewDone={onInitPreviewDone}
      />
    </StyledPromptThread>
  );
}
