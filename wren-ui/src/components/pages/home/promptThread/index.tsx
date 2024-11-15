import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef } from 'react';
import { Divider } from 'antd';
import styled from 'styled-components';
import AnswerResult from './AnswerResult';
import { makeIterable, IterableComponent } from '@/utils/iteration';
import {
  DetailedThread,
  ThreadResponse,
} from '@/apollo/client/graphql/__types__';
import { getIsFinished } from '@/hooks/useAskPrompt';

interface Props {
  data: DetailedThread;
  onOpenSaveAsViewModal: (data: { sql: string; responseId: number }) => void;
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
  IterableComponent<ThreadResponse> & {
    motion: boolean;
    onOpenSaveAsViewModal: (data: { sql: string; responseId: number }) => void;
    onInitPreviewDone: () => void;
  }
> = ({
  data,
  index,
  motion,
  onOpenSaveAsViewModal,
  onInitPreviewDone,
  ...threadResponse
}) => {
  const { id } = threadResponse;
  const lastResponseId = data[data.length - 1].id;
  const isLastThreadResponse = id === lastResponseId;

  return (
    <div key={`${id}-${index}`}>
      {index > 0 && <Divider />}
      <AnswerResult
        motion={motion}
        isLastThreadResponse={isLastThreadResponse}
        onOpenSaveAsViewModal={onOpenSaveAsViewModal}
        onInitPreviewDone={onInitPreviewDone}
        threadResponse={threadResponse}
      />
    </div>
  );
};

const AnswerResultIterator = makeIterable(AnswerResultTemplate);

export default function PromptThread(props: Props) {
  const router = useRouter();
  const divRef = useRef<HTMLDivElement>(null);
  const motionResponsesRef = useRef<Record<number, boolean>>({});
  const { data, onOpenSaveAsViewModal } = props;

  const responses = useMemo(
    () =>
      (data?.responses || []).map((response) => ({
        ...response,
        motion: motionResponsesRef.current[response.id],
      })),
    [data?.responses],
  );

  const triggerScrollToBottom = (behavior?: ScrollBehavior) => {
    if ((data?.responses || []).length <= 1) return;
    const contentLayout = divRef.current?.parentElement;
    const lastChild = divRef.current?.lastElementChild as HTMLElement;
    const lastChildElement = lastChild?.lastElementChild as HTMLElement;
    const dividerSpace = 48;
    if (contentLayout && lastChildElement) {
      contentLayout.scrollTo({
        top: lastChildElement.offsetTop - dividerSpace,
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
    motionResponsesRef.current = (data?.responses || []).reduce(
      (result, item) => {
        result[item.id] = !getIsFinished(item?.status);
        return result;
      },
      {},
    );
    const lastResponseMotion = Object.values(motionResponsesRef.current).pop();
    triggerScrollToBottom(lastResponseMotion ? 'smooth' : 'auto');
  }, [data?.responses]);

  const onInitPreviewDone = () => {
    triggerScrollToBottom();
  };

  return (
    <StyledPromptThread className="mt-12" ref={divRef}>
      <AnswerResultIterator
        data={responses}
        onOpenSaveAsViewModal={onOpenSaveAsViewModal}
        onInitPreviewDone={onInitPreviewDone}
      />
    </StyledPromptThread>
  );
}
