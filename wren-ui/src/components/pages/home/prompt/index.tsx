import {
  useEffect,
  useMemo,
  useState,
  forwardRef,
  useImperativeHandle,
} from 'react';
import styled from 'styled-components';
import { PROCESS_STATE } from '@/utils/enum';
import PromptInput from '@/components/pages/home/prompt/Input';
import PromptResult from '@/components/pages/home/prompt/Result';
import useAskProcessState, {
  getIsProcessing,
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
  inputProps: {
    placeholder: string;
  };
}

interface Attributes {
  submit: (value: string) => void;
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

export default forwardRef<Attributes, Props>(function Prompt(props, ref) {
  const {
    data,
    loading,
    onSubmit,
    onStop,
    onCreateResponse,
    onStopStreaming,
    onStopRecommend,
    inputProps,
  } = props;
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
      askingStreamTask, // for general answer
      recommendedQuestions, // guiding user to ask
      intentReasoning: askingTask?.intentReasoning || '',
    }),
    [data],
  );
  const error = useMemo(() => askingTask?.error || null, [askingTask?.error]);
  const [showResult, setShowResult] = useState(false);
  const [question, setQuestion] = useState('');
  const currentProcessState = useMemo(
    () => askProcessState.currentState,
    [askProcessState.currentState],
  );
  const isProcessing = useMemo(
    () => getIsProcessing(currentProcessState),
    [currentProcessState],
  );

  useEffect(() => {
    if (askingTask) {
      const processState = askProcessState.matchedState(askingTask);
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
  };

  // create thread response for text to sql
  const intentSQLAnswer = async () => {
    onCreateResponse &&
      (await onCreateResponse({ question, taskId: askingTask?.queryId }));
    setShowResult(false);
  };

  const closeResult = () => {
    askProcessState.resetState();
    setQuestion('');
    onStopStreaming && onStopStreaming();
    onStopRecommend && onStopRecommend();
  };

  const stopProcess = async () => {
    onStop && (await onStop());
    setShowResult(false);
    askProcessState.resetState();
  };

  const submitAsk = async (value: string) => {
    setQuestion(value);
    if (isProcessing || !value) return;
    // start the state as understanding when user submit question
    askProcessState.transitionTo(PROCESS_STATE.UNDERSTANDING);
    setShowResult(true);
    onSubmit && (await onSubmit(value));
  };

  useImperativeHandle(
    ref,
    () => ({
      submit: submitAsk,
      close: closeResult,
    }),
    [question, isProcessing, setQuestion],
  );

  return (
    <PromptStyle className="d-flex align-end bg-gray-2 p-3 border border-gray-3 rounded">
      <PromptInput
        question={question}
        isProcessing={isProcessing}
        onAsk={submitAsk}
        inputProps={inputProps}
      />

      {showResult && (
        <PromptResult
          data={result}
          error={error}
          loading={loading}
          processState={currentProcessState}
          onSelectRecommendedQuestion={selectRecommendedQuestion}
          onIntentSQLAnswer={intentSQLAnswer}
          onClose={closeResult}
          onStop={stopProcess}
        />
      )}
    </PromptStyle>
  );
});
