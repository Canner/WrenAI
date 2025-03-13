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
  convertAskingTaskToProcessState,
} from '@/hooks/useAskProcessState';
import { AskPromptData } from '@/hooks/useAskPrompt';
import {
  CreateThreadInput,
  CreateThreadResponseInput,
} from '@/apollo/client/graphql/__types__';

interface Props {
  onCreateResponse: (
    payload: CreateThreadInput | CreateThreadResponseInput,
  ) => Promise<void>;
  onStop: () => void;
  onSubmit: (value: string) => Promise<void>;
  onStopPolling: () => void;
  onStopStreaming: () => void;
  onStopRecommend: () => void;
  data: AskPromptData;
  loading: boolean;
}

interface Attributes {
  setValue: (value: string) => void;
  submit: () => void;
  close: () => void;
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

export default forwardRef<Attributes, Props>(function Prompt(props, ref) {
  const $promptInput = useRef<HTMLTextAreaElement>(null);
  const {
    data,
    loading,
    onSubmit,
    onStop,
    onCreateResponse,
    onStopStreaming,
    onStopRecommend,
  } = props;
  const [inputValue, setInputValue] = useState('');
  const askProcessState = useAskProcessState();

  const {
    originalQuestion,
    askingTask,
    askingStreamTask,
    recommendedQuestions,
  } = data;

  const result = useMemo(
    () => ({
      type: askingTask?.type, // question's type
      originalQuestion, // original question
      candidates: askingTask?.candidates || [], // for text to sql answer, only one candidate
      askingStreamTask, // for general answer
      recommendedQuestions, // guiding user to ask
      intentReasoning: askingTask?.intentReasoning || '',
    }),
    [data],
  );
  const error = useMemo(() => askingTask?.error || null, [askingTask?.error]);
  const question = useMemo(() => inputValue.trim(), [inputValue]);
  const isProcessing = useMemo(
    () => getIsProcessing(askProcessState.currentState),
    [askProcessState.currentState],
  );

  useEffect(() => {
    if (!isProcessing) $promptInput.current?.focus();
  }, [isProcessing]);

  useEffect(() => {
    if (askingTask) {
      const processState = convertAskingTaskToProcessState(askingTask);
      askProcessState.canTransitionTo(processState) &&
        askProcessState.transitionTo(processState);
    }
  }, [askingTask]);

  useEffect(() => {
    if (error) {
      !askProcessState.isFailed() &&
        askProcessState.transitionTo(PROCESS_STATE.FAILED);
    }
  }, [error]);

  // create thread response for recommended question
  const selectRecommendedQuestion = async (payload: {
    question: string;
    sql: string;
  }) => {
    onCreateResponse && (await onCreateResponse(payload));
    closeResult();
    askProcessState.resetState();
  };

  // create thread response for text to sql
  const intentSQLAnswer = async () => {
    onCreateResponse &&
      (await onCreateResponse({ question, taskId: askingTask?.queryId }));
    closeResult();
    askProcessState.resetState();
  };

  const closeResult = () => {
    askProcessState.resetState();
    setInputValue('');
    onStopStreaming && onStopStreaming();
    onStopRecommend && onStopRecommend();
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
    // start the state as understanding when user submit question
    askProcessState.transitionTo(PROCESS_STATE.UNDERSTANDING);
    onSubmit && (await onSubmit(question));
  };

  useImperativeHandle(
    ref,
    () => ({
      setValue: (value: string) => setInputValue(value),
      submit: submitAsk,
      close: closeResult,
    }),
    [question, isProcessing, setInputValue],
  );

  return (
    <PromptStyle className="d-flex align-end bg-gray-2 p-3 border border-gray-3 rounded">
      <Input.TextArea
        ref={$promptInput}
        // disable grammarly
        data-gramm="false"
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
        data={result}
        error={error}
        loading={loading}
        processState={askProcessState}
        onSelectRecommendedQuestion={selectRecommendedQuestion}
        onIntentSQLAnswer={intentSQLAnswer}
        onClose={closeResult}
        onStop={stopProcess}
      />
    </PromptStyle>
  );
});
