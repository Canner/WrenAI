import React, { useEffect, useRef } from 'react';
import { Divider } from 'antd';
import styled from 'styled-components';
import AnswerResult from './AnswerResult';
import { IterableComponent, makeIterable } from '@/utils/iteration';
import {
  DetailedThread,
  ThreadResponse,
} from '@/apollo/client/graphql/__types__';

interface Props {
  data: DetailedThread;
  onOpenSaveAsViewModal: (data: { sql: string; responseId: number }) => void;
  onSubmitReviewDrawer: (variables: any) => Promise<void>;
  onTriggerThreadResponseExplain: (variables: any) => Promise<void>;
}

const StyledThread = styled.div`
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

const StyledContainer = styled.div`
  max-width: 1030px;
`;

const AnswerResultTemplate: React.FC<
  IterableComponent<ThreadResponse> & {
    onOpenSaveAsViewModal: (data: { sql: string; responseId: number }) => void;
    onTriggerScrollToBottom: () => void;
    onSubmitReviewDrawer: (variables: any) => Promise<void>;
    onTriggerThreadResponseExplain: (variables: any) => Promise<void>;
  }
> = ({
  onOpenSaveAsViewModal,
  onTriggerScrollToBottom,
  onSubmitReviewDrawer,
  onTriggerThreadResponseExplain,
  data,
  index,
  ...threadResponse
}) => {
  const lastResponseId = data[data.length - 1].id;
  const isLastThreadResponse = threadResponse.id === lastResponseId;
  const { id } = threadResponse;

  return (
    <StyledContainer className="mx-auto" key={`${id}-${index}`}>
      {index > 0 && <Divider />}
      <AnswerResult
        threadResponse={threadResponse}
        isLastThreadResponse={isLastThreadResponse}
        onOpenSaveAsViewModal={onOpenSaveAsViewModal}
        onTriggerScrollToBottom={onTriggerScrollToBottom}
        onSubmitReviewDrawer={onSubmitReviewDrawer}
        onTriggerThreadResponseExplain={onTriggerThreadResponseExplain}
      />
    </StyledContainer>
  );
};

const AnswerResultIterator = makeIterable(AnswerResultTemplate);

export default function Thread(props: Props) {
  const {
    data,
    onOpenSaveAsViewModal,
    onSubmitReviewDrawer,
    onTriggerThreadResponseExplain,
  } = props;
  const divRef = useRef<HTMLDivElement>(null);

  const triggerScrollToBottom = () => {
    const contentLayout = divRef.current?.parentElement;
    if (!contentLayout) return;
    const lastChild = divRef.current.lastElementChild as HTMLElement;
    const lastChildElement = lastChild.lastElementChild as HTMLElement;

    if (
      contentLayout.clientHeight <
      lastChild.offsetTop + lastChild.clientHeight
    ) {
      contentLayout.scrollTo({
        top: lastChildElement.offsetTop,
        behavior: 'smooth',
      });
    }
  };

  useEffect(() => {
    if (divRef.current && data?.responses.length > 0) {
      triggerScrollToBottom();
    }
  }, [divRef, data]);

  return (
    <StyledThread className="px-4 mt-12" ref={divRef}>
      <AnswerResultIterator
        data={data?.responses || []}
        onOpenSaveAsViewModal={onOpenSaveAsViewModal}
        onTriggerScrollToBottom={triggerScrollToBottom}
        onSubmitReviewDrawer={onSubmitReviewDrawer}
        onTriggerThreadResponseExplain={onTriggerThreadResponseExplain}
      />
    </StyledThread>
  );
}
