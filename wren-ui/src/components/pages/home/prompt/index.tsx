import { useEffect, useMemo, useState } from 'react';
import { Input, Button } from 'antd';
import styled from 'styled-components';
import { PROCESS_STATE } from '@/utils/enum';
import PromptResult from '@/components/pages/home/prompt/Result';
import useAskProcessState from '@/hooks/useAskProcessState';

interface Props {
  onStop: () => void;
  onSubmit: (value: string) => void;
  data?: { status: string; result: { sql: string; summary: string }[] };
  error?: any;
}

const PromptStyle = styled.div`
  position: fixed;
  width: 768px;
  left: 50%;
  margin-left: calc(-384px + 140px);
  bottom: 12px;
`;

const PromptButton = styled(Button)`
  min-width: 72px;
`;

const convertToProcessState = (status: string) => {
  return {
    understanding: PROCESS_STATE.UNDERSTANDING,
    searching: PROCESS_STATE.SEARCHING,
    finished: PROCESS_STATE.FINISHED,
  }[status];
};

const convertToErrorState = (status: string) => {
  return {
    understanding: PROCESS_STATE.UNDERSTANDING_FAILED,
    searching: PROCESS_STATE.SEARCHING_FAILED,
    finished: PROCESS_STATE.NO_RESULT,
  }[status];
};

export default function Prompt(props: Props) {
  const { data, error, onSubmit, onStop } = props;
  const [inputValue, setInputValue] = useState('');
  const askProcessState = useAskProcessState();

  const results = useMemo(() => data.result || [], [data]);
  const question = useMemo(() => inputValue.trim(), [inputValue]);
  const isProcessing = useMemo(
    () =>
      [PROCESS_STATE.UNDERSTANDING, PROCESS_STATE.SEARCHING].includes(
        askProcessState.currentState,
      ),
    [askProcessState.currentState],
  );

  useEffect(() => {
    if (data) {
      const processState = convertToProcessState(data.status);
      askProcessState.setState(processState);
    }
  }, [data]);

  useEffect(() => {
    if (error) {
      // TODO: confirm error state
      const errorState = convertToErrorState(error.status);
      askProcessState.setState(errorState);
    }
  }, [error]);

  const closeResult = () => {
    askProcessState.resetState();
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
        size="large"
        autoSize
        placeholder="Ask to explore your data"
        value={inputValue}
        onInput={syncInputValue}
        onPressEnter={inputEnter}
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
        data={results}
        error={error}
        processState={askProcessState}
        onClose={closeResult}
        onStop={stopProcess}
      />
    </PromptStyle>
  );
}
