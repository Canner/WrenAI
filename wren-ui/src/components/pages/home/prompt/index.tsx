import { useEffect, useMemo, useRef, useState } from 'react';
import { Input, Button } from 'antd';
import styled from 'styled-components';
import { PROCESS_STATE } from '@/utils/enum';
import PromptResult from '@/components/pages/home/prompt/Result';
import useAskProcessState from '@/hooks/useAskProcessState';
import {
  AskingTask,
  AskingTaskStatus,
} from '@/apollo/client/graphql/__types__';

interface Props {
  onSelect: (payload: {
    sql: string;
    summary: string;
    question: string;
  }) => void;
  onStop: () => void;
  onSubmit: (value: string) => void;
  data?: AskingTask;
}

const PromptStyle = styled.div`
  position: fixed;
  width: 768px;
  left: 50%;
  margin-left: calc(-384px + 133px);
  bottom: 12px;
  z-index: 999;
`;

const PromptButton = styled(Button)`
  min-width: 72px;
`;

const convertToProcessState = (data: AskingTask) => {
  const processState = {
    [AskingTaskStatus.Understanding]: PROCESS_STATE.UNDERSTANDING,
    [AskingTaskStatus.Searching]: PROCESS_STATE.SEARCHING,
    [AskingTaskStatus.Generating]: PROCESS_STATE.GENERATING,
    [AskingTaskStatus.Finished]: PROCESS_STATE.FINISHED,
  }[data.status];

  if (processState === PROCESS_STATE.FINISHED && data.candidates.length === 0) {
    return PROCESS_STATE.NO_RESULT;
  }
  return processState;
};

export default function Prompt(props: Props) {
  const $promptInput = useRef<HTMLTextAreaElement>(null);
  const { data, onSubmit, onStop, onSelect } = props;
  const [inputValue, setInputValue] = useState('');
  const askProcessState = useAskProcessState();

  const candidates = useMemo(() => data?.candidates || [], [data?.candidates]);
  const error = useMemo(() => data?.error || null, [data?.error]);
  const question = useMemo(() => inputValue.trim(), [inputValue]);
  const isProcessing = useMemo(
    () =>
      [
        PROCESS_STATE.UNDERSTANDING,
        PROCESS_STATE.GENERATING,
        PROCESS_STATE.SEARCHING,
      ].includes(askProcessState.currentState),
    [askProcessState.currentState],
  );

  useEffect(() => {
    if (!isProcessing) {
      $promptInput.current?.focus();
    }
  }, [isProcessing]);

  useEffect(() => {
    if (data) {
      const processState = convertToProcessState(data);
      askProcessState.setState(processState);
    }
  }, [data]);

  useEffect(() => {
    if (error) {
      askProcessState.setState(PROCESS_STATE.ASKING_FAILED);
    }
  }, [error]);

  const selectResult = (payload) => {
    onSelect && onSelect({ ...payload, question });
    closeResult();
  };

  const closeResult = () => {
    askProcessState.resetState();
    setInputValue('');
  };

  const stopProcess = () => {
    askProcessState.resetState();
    onStop && onStop();
  };

  const syncInputValue = (event) => {
    setInputValue(event.target.value);
  };

  const inputEnter = (event) => {
    if (event.shiftKey) return;
    event.preventDefault();

    if (!isProcessing) submitAsk();
  };

  const submitAsk = async () => {
    if (question) {
      onSubmit && (await onSubmit(question));
    }
  };

  return (
    <PromptStyle className="d-flex align-end bg-gray-2 p-3 border border-gray-3 rounded">
      <Input.TextArea
        ref={$promptInput}
        size="large"
        autoSize
        placeholder="Ask to explore your data"
        value={inputValue}
        onInput={syncInputValue}
        onPressEnter={inputEnter}
        disabled={isProcessing}
      />
      <PromptButton
        type="primary"
        size="large"
        className="ml-3"
        onClick={submitAsk}
        disabled={isProcessing}
      >
        Ask
      </PromptButton>

      <PromptResult
        data={candidates}
        error={error}
        processState={askProcessState}
        onSelect={selectResult}
        onClose={closeResult}
        onStop={stopProcess}
      />
    </PromptStyle>
  );
}
