import { useEffect, useRef } from 'react';
import { Alert, Divider } from 'antd';
import styled from 'styled-components';
import AnswerResult from './AnswerResult';
import { makeIterable } from '@/utils/iteration';
import {
  AskingTaskStatus,
  DetailedThread,
} from '@/apollo/client/graphql/__types__';

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
`;

const AnswerResultTemplate = ({
  id,
  data,
  index,
  error,
  status,
  detail,
  summary,
  question,
  // callbacks
  onOpenSaveAsViewModal,
  onInitPreviewDone,
}) => {
  const lastResponseId = data[data.length - 1].id;
  const isLastThreadResponse = id === lastResponseId;

  return (
    <div key={`${id}-${index}`}>
      {index > 0 && <Divider />}
      {error ? (
        <Alert
          message={error.shortMessage}
          description={error.message}
          type="error"
          showIcon
        />
      ) : (
        <AnswerResult
          answerResultSteps={detail?.steps}
          description={detail?.description}
          loading={status !== AskingTaskStatus.FINISHED}
          question={question}
          summary={summary}
          view={detail?.view}
          fullSql={detail?.sql}
          threadResponseId={id}
          onOpenSaveAsViewModal={onOpenSaveAsViewModal}
          onInitPreviewDone={onInitPreviewDone}
          isLastThreadResponse={isLastThreadResponse}
        />
      )}
    </div>
  );
};

const AnswerResultIterator = makeIterable(AnswerResultTemplate);

export default function PromptThread(props: Props) {
  const { data, onOpenSaveAsViewModal } = props;
  const divRef = useRef<HTMLDivElement>(null);

  const triggerScrollToBottom = () => {
    const contentLayout = divRef.current?.parentElement;
    const lastChild = divRef.current.lastElementChild as HTMLElement;
    const lastChildElement = lastChild.lastElementChild as HTMLElement;

    if (contentLayout) {
      contentLayout.scrollTo({
        top: lastChildElement.offsetTop,
      });
    }
  };

  useEffect(() => {
    if (divRef.current && data?.responses.length > 0) {
      triggerScrollToBottom();
    }
  }, [data]);

  const onInitPreviewDone = () => {
    triggerScrollToBottom();
  };

  return (
    <StyledPromptThread className="mt-12" ref={divRef}>
      <AnswerResultIterator
        data={data?.responses || []}
        onOpenSaveAsViewModal={onOpenSaveAsViewModal}
        onInitPreviewDone={onInitPreviewDone}
      />
    </StyledPromptThread>
  );
}
