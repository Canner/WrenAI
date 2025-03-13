import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef } from 'react';
import { Divider } from 'antd';
import styled from 'styled-components';
import AnswerResult from './AnswerResult';
import { makeIterable, IterableComponent } from '@/utils/iteration';
import { getAnswerIsFinished } from '@/components/pages/home/promptThread/TextBasedAnswer';
import {
  AdjustThreadResponseChartInput,
  DetailedThread,
  RecommendedQuestionsTask,
  ThreadResponse,
} from '@/apollo/client/graphql/__types__';
import { SelectQuestionProps } from '@/components/pages/home/RecommendedQuestions';

export interface RecommendedQuestionsProps {
  data: RecommendedQuestionsTask;
  show: boolean;
  onSelect: ({ question, sql }: SelectQuestionProps) => void;
}

interface Props {
  data: {
    thread: DetailedThread;
    recommendedQuestions: RecommendedQuestionsTask;
    showRecommendedQuestions: boolean;
  };
  onOpenSaveAsViewModal: (data: { sql: string; responseId: number }) => void;
  onSelect: ({ question, sql }: SelectQuestionProps) => void;
  onRegenerateTextBasedAnswer: (responseId: number) => void;
  onGenerateBreakdownAnswer: (responseId: number) => void;
  onGenerateChartAnswer: (responseId: number) => Promise<void>;
  onAdjustChartAnswer: (
    responseId: number,
    data: AdjustThreadResponseChartInput,
  ) => Promise<void>;
  onOpenSaveToKnowledgeModal: (
    data: { sql: string; question: string },
    payload: { isCreateMode: boolean },
  ) => void;
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

  .promptThread-answer {
    opacity: 0;
    animation: fade-in 0.6s ease-out forwards;
  }
`;

const AnswerResultTemplate: React.FC<
  IterableComponent<ThreadResponse> &
    Pick<
      Props,
      | 'onOpenSaveAsViewModal'
      | 'onRegenerateTextBasedAnswer'
      | 'onGenerateBreakdownAnswer'
      | 'onGenerateChartAnswer'
      | 'onAdjustChartAnswer'
      | 'onOpenSaveToKnowledgeModal'
    > & {
      motion: boolean;
      onInitPreviewDone: () => void;
      recommendedQuestionsProps: RecommendedQuestionsProps;
    }
> = ({
  data,
  index,
  motion,
  recommendedQuestionsProps,
  onOpenSaveAsViewModal,
  onInitPreviewDone,
  onGenerateBreakdownAnswer,
  onRegenerateTextBasedAnswer,
  onGenerateChartAnswer,
  onAdjustChartAnswer,
  onOpenSaveToKnowledgeModal,
  ...threadResponse
}) => {
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
        onOpenSaveAsViewModal={onOpenSaveAsViewModal}
        onInitPreviewDone={onInitPreviewDone}
        threadResponse={threadResponse}
        recommendedQuestionsProps={recommendedQuestionsProps}
        onGenerateBreakdownAnswer={onGenerateBreakdownAnswer}
        onRegenerateTextBasedAnswer={onRegenerateTextBasedAnswer}
        onGenerateChartAnswer={onGenerateChartAnswer}
        onAdjustChartAnswer={onAdjustChartAnswer}
        onOpenSaveToKnowledgeModal={onOpenSaveToKnowledgeModal}
      />
    </div>
  );
};

const AnswerResultIterator = makeIterable(AnswerResultTemplate);

export default function PromptThread(props: Props) {
  const router = useRouter();
  const divRef = useRef<HTMLDivElement>(null);
  const motionResponsesRef = useRef<Record<number, boolean>>({});
  const { data, onSelect, ...restProps } = props;

  const responses = useMemo(
    () =>
      (data.thread?.responses || []).map((response) => ({
        ...response,
        motion: motionResponsesRef.current[response.id],
      })),
    [data.thread?.responses],
  );

  const triggerScrollToBottom = (behavior?: ScrollBehavior) => {
    if ((data.thread?.responses || []).length <= 1) return;
    const contentLayout = divRef.current?.parentElement;
    const allElements = (divRef.current?.querySelectorAll(
      '.adm-answer-result',
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
    motionResponsesRef.current = (data.thread?.responses || []).reduce(
      (result, item) => {
        result[item.id] = !getAnswerIsFinished(item?.answerDetail?.status);
        return result;
      },
      {},
    );

    if (
      data.thread?.responses?.length >
      Object.keys(motionResponsesRef.current).length
    ) {
      const lastResponseMotion = Object.values(
        motionResponsesRef.current,
      ).pop();
      triggerScrollToBottom(lastResponseMotion ? 'smooth' : 'auto');
    }
  }, [data.thread?.responses]);

  const onInitPreviewDone = () => {
    triggerScrollToBottom();
  };

  return (
    <StyledPromptThread className="mt-12" ref={divRef}>
      <AnswerResultIterator
        {...restProps}
        data={responses}
        onInitPreviewDone={onInitPreviewDone}
        recommendedQuestionsProps={{
          data: data.recommendedQuestions,
          show: data.showRecommendedQuestions,
          onSelect,
        }}
      />
    </StyledPromptThread>
  );
}
