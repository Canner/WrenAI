import {
  useEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { Input, Button } from 'antd';
import styled from 'styled-components';
import { PROCESS_STATE } from '@/utils/enum';
import PromptResult from '@/components/pages/home/prompt/Result';
import useAskProcessState, {
  getIsProcessing,
} from '@/hooks/useAskProcessState';
import {
  AskingTask,
  AskingTaskStatus,
} from '@/apollo/client/graphql/__types__';

interface Props {
  onSelect: (payload: {
    sql?: string;
    summary?: string;
    question?: string;
    viewId?: number;
  }) => void;
  onStop: () => void;
  onSubmit: (value: string) => void;
  data?: AskingTask;
}

interface Attributes {
  setValue: (value: string) => void;
  submit: () => void;
}

const PromptStyle = styled.div`
  position: fixed;
  width: 680px;
  left: 50%;
  margin-left: calc(-340px + 133px);
  bottom: 18px;
  z-index: 999;
  box-shadow:
    rgba(0, 0, 0, 0.1) 0px 10px 15px -3px,
    rgba(0, 0, 0, 0.05) 0px 4px 6px -2px;
`;

const PromptButton = styled(Button)`
  min-width: 72px;
`;

const convertAskingTaskToProcessState = (data: AskingTask) => {
  const processState = {
    [AskingTaskStatus.UNDERSTANDING]: PROCESS_STATE.UNDERSTANDING,
    [AskingTaskStatus.SEARCHING]: PROCESS_STATE.SEARCHING,
    [AskingTaskStatus.GENERATING]: PROCESS_STATE.GENERATING,
    [AskingTaskStatus.FINISHED]: PROCESS_STATE.FINISHED,
  }[data.status];

  if (processState === PROCESS_STATE.FINISHED && data.candidates.length === 0) {
    return PROCESS_STATE.NO_RESULT;
  }
  return processState;
};

export default forwardRef<Attributes, Props>(function Prompt(props, ref) {
  const $promptInput = useRef<HTMLTextAreaElement>(null);
  const { data, onSubmit, onStop, onSelect } = props;
  const [inputValue, setInputValue] = useState('');
  const askProcessState = useAskProcessState();

  const candidates = useMemo(() => data?.candidates || [], [data?.candidates]);
  const error = useMemo(() => data?.error || null, [data?.error]);
  const question = useMemo(() => inputValue.trim(), [inputValue]);
  const isProcessing = useMemo(
    () => getIsProcessing(askProcessState.currentState),
    [askProcessState.currentState],
  );

  useEffect(() => {
    if (!isProcessing) $promptInput.current?.focus();
  }, [isProcessing]);

  useEffect(() => {
    if (data) {
      const processState = convertAskingTaskToProcessState(data);
      askProcessState.setState(processState);
    }
  }, [data]);

  useEffect(() => {
    if (error) {
      askProcessState.setState(PROCESS_STATE.FAILED);
    }
  }, [error]);

  const selectResult = (payload) => {
    const isSavedViewCandidate = !!payload.viewId;
    const data = isSavedViewCandidate
      ? { viewId: payload.viewId }
      : {
          sql: payload.sql,
          summary: payload.summary,
          question,
        };
    onSelect && onSelect(data);
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
    submitAsk();
  };

  const submitAsk = async () => {
    if (isProcessing || !question) return;

    onSubmit && (await onSubmit(question));
  };

  useImperativeHandle(
    ref,
    () => ({
      setValue: (value: string) => setInputValue(value),
      submit: submitAsk,
    }),
    [question, isProcessing, setInputValue],
  );

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
});
