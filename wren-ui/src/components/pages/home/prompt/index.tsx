import {
  useCallback,
  forwardRef,
  ReactNode,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import styled, { css } from 'styled-components';
import { PROCESS_STATE } from '@/utils/enum';
import PromptInput from '@/components/pages/home/prompt/Input';
import PromptResult from '@/components/pages/home/prompt/Result';
import useAskProcessState, {
  getIsProcessing,
} from '@/hooks/useAskProcessState';
import type {
  CreateThreadInput,
  CreateThreadResponseInput,
} from '@/types/home';
import { AskPromptData } from '@/hooks/useAskPrompt';
import type { PromptInputHandle } from '@/components/pages/home/prompt/Input';

interface Props {
  onCreateResponse: (
    payload: CreateThreadInput | CreateThreadResponseInput,
  ) => Promise<void>;
  onStop: () => void;
  onSubmit: (
    value: string,
  ) => Promise<void | { handledInlineResult?: boolean }>;
  onStopPolling: () => void;
  onStopStreaming: () => void;
  onStopRecommend: () => void;
  data: AskPromptData;
  loading: boolean;
  inputProps: {
    placeholder: string;
  };
  leadingIcon?: ReactNode;
  variant?: 'fixed' | 'sticky' | 'embedded';
  buttonMode?: 'text' | 'icon';
  inputLayout?: 'inline' | 'stacked';
  footerContent?: ReactNode;
  inputDisabled?: boolean;
  onAtTrigger?: () => void;
  showInlineResult?: boolean;
  className?: string;
}

interface Attributes {
  submit: (value: string) => void;
  setDraft: (value: string) => void;
  focus: () => void;
  close: () => void;
}

const PromptStyle = styled.div<{ $variant: 'fixed' | 'sticky' | 'embedded' }>`
  width: 100%;
  display: flex;
  align-items: flex-end;
  gap: 12px;
  background: #fff;
  border: 1px solid rgba(15, 23, 42, 0.08);
  border-radius: 20px;
  padding: 14px 16px;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.08);

  ${(props) =>
    props.$variant === 'fixed' &&
    css`
      position: fixed;
      left: calc(50% + 140px);
      transform: translateX(-50%);
      bottom: 18px;
      z-index: 999;
      max-width: 760px;
    `}

  ${(props) =>
    props.$variant === 'sticky' &&
    css`
      position: sticky;
      bottom: 20px;
      z-index: 12;
    `}

  ${(props) =>
    props.$variant === 'embedded' &&
    css`
      position: relative;
      box-shadow: none;
      border: 0;
      border-radius: 0;
      padding: 0;
      background: transparent;
    `}
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
    leadingIcon,
    variant = 'fixed',
    buttonMode = 'text',
    inputLayout = 'inline',
    footerContent,
    inputDisabled = false,
    onAtTrigger,
    showInlineResult = true,
    className,
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
      type: askingTask?.type,
      originalQuestion,
      askingStreamTask,
      recommendedQuestions,
      intentReasoning: askingTask?.intentReasoning || '',
    }),
    [data],
  );
  const error = useMemo(() => askingTask?.error || null, [askingTask?.error]);
  const [showResult, setShowResult] = useState(false);
  const [question, setQuestion] = useState('');
  const promptInputRef = useRef<PromptInputHandle>(null);
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

  const selectRecommendedQuestion = async (payload: {
    question: string;
    sql: string;
  }) => {
    onCreateResponse && (await onCreateResponse(payload));
    closeResult();
  };

  const intentSQLAnswer = async () => {
    onCreateResponse &&
      (await onCreateResponse({ question, taskId: askingTask?.queryId }));
    closeResult();
  };

  const closeResult = () => {
    setShowResult(false);
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
    if (showInlineResult) {
      askProcessState.transitionTo(PROCESS_STATE.UNDERSTANDING);
      setShowResult(true);
    }
    const submitResult = onSubmit && (await onSubmit(value));
    if (submitResult?.handledInlineResult) {
      closeResult();
    }
  };

  const setDraftQuestion = useCallback((value: string) => {
    setQuestion(value);
    promptInputRef.current?.focus();
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      submit: submitAsk,
      setDraft: setDraftQuestion,
      focus: () => {
        promptInputRef.current?.focus();
      },
      close: closeResult,
    }),
    [closeResult, setDraftQuestion, submitAsk],
  );

  return (
    <PromptStyle $variant={variant} className={className}>
      <PromptInput
        ref={promptInputRef}
        question={question}
        isProcessing={isProcessing}
        onAsk={submitAsk}
        inputProps={inputProps}
        leadingIcon={leadingIcon}
        buttonMode={buttonMode}
        layout={inputLayout}
        footerContent={footerContent}
        disabled={inputDisabled}
        onAtTrigger={onAtTrigger}
      />

      {showInlineResult && showResult && (
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
