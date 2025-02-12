import { ReactNode, useEffect, useRef } from 'react';
import { Button } from 'antd';
import styled from 'styled-components';
import { PROCESS_STATE } from '@/utils/enum';
import CloseOutlined from '@ant-design/icons/CloseOutlined';
import StopOutlined from '@ant-design/icons/StopFilled';
import LoadingOutlined from '@ant-design/icons/LoadingOutlined';
import CloseCircleFilled from '@ant-design/icons/CloseCircleFilled';
import WarningOutlined from '@ant-design/icons/WarningOutlined';
import MessageOutlined from '@ant-design/icons/MessageOutlined';
import ErrorCollapse from '@/components/ErrorCollapse';
import InfoCircleOutlined from '@ant-design/icons/InfoCircleOutlined';
import useAskProcessState from '@/hooks/useAskProcessState';
import RecommendedQuestions, {
  getRecommendedQuestionProps,
} from '@/components/pages/home/RecommendedQuestions';
import MarkdownBlock from '@/components/editor/MarkdownBlock';
import {
  AskingTask,
  AskingTaskType,
  RecommendedQuestionsTask,
} from '@/apollo/client/graphql/__types__';

const StyledResult = styled.div`
  position: absolute;
  bottom: calc(100% + 12px);
  left: 0;
  width: 100%;
  background: white;
  box-shadow:
    rgba(0, 0, 0, 0.1) 0px 10px 15px -3px,
    rgba(0, 0, 0, 0.05) 0px 4px 6px -2px;
`;

interface Props {
  processState: ReturnType<typeof useAskProcessState>;
  data: {
    type: AskingTaskType;
    originalQuestion: string;
    candidates: AskingTask['candidates'];
    askingStreamTask: string;
    recommendedQuestions: RecommendedQuestionsTask;
    intentReasoning: string;
  };
  error?: any;
  onSelectResult: (payload: { sql: string; viewId: number | null }) => void;
  onSelectQuestion: ({
    question,
    sql,
  }: {
    question: string;
    sql: string;
  }) => void;
  onClose: () => void;
  onStop: () => void;
  loading?: boolean;
}

const Wrapper = ({ children }) => {
  return (
    <StyledResult
      className="border border-gray-3 rounded p-4"
      data-testid="prompt__result"
    >
      {children}
    </StyledResult>
  );
};

const makeProcessing = (text: string) => (props: Props) => {
  const { onStop } = props;
  return (
    <Wrapper>
      <div className="d-flex justify-space-between">
        <span>
          <LoadingOutlined className="mr-2 geekblue-6 text-lg" spin />
          {text}
        </span>
        <Button
          className="adm-btn-no-style gray-7 bg-gray-3 text-sm px-2"
          type="text"
          size="small"
          onClick={onStop}
        >
          <StopOutlined className="-mr-1" />
          Stop
        </Button>
      </div>
    </Wrapper>
  );
};

const makeProcessingError =
  (config: { icon: ReactNode; title?: string; description?: string }) =>
  (props: Props) => {
    const { onClose, onSelectQuestion, data, error } = props;
    const { message, shortMessage, stacktrace } = error || {};
    const hasStacktrace = !!stacktrace;

    const recommendedQuestionProps = getRecommendedQuestionProps(
      data?.recommendedQuestions,
    );

    return (
      <Wrapper>
        <div className="d-flex justify-space-between text-medium mb-2">
          <div className="d-flex align-center">
            {config.icon}
            {config.title || shortMessage}
          </div>
          <Button
            className="adm-btn-no-style gray-7 bg-gray-3 text-sm px-2"
            type="text"
            size="small"
            onClick={onClose}
          >
            <CloseOutlined className="-mr-1" />
            Close
          </Button>
        </div>
        <div className="gray-7">
          {config.description || data.intentReasoning || message}
        </div>
        {hasStacktrace && (
          <ErrorCollapse className="mt-2" message={stacktrace.join('\n')} />
        )}

        {recommendedQuestionProps.show && (
          <RecommendedQuestions
            className="mt-2"
            {...recommendedQuestionProps.state}
            onSelect={onSelectQuestion}
          />
        )}
      </Wrapper>
    );
  };

const ErrorIcon = () => <CloseCircleFilled className="mr-2 red-5 text-lg" />;

const Failed = makeProcessingError({
  icon: <ErrorIcon />,
});

const NoResult = makeProcessingError({
  icon: <WarningOutlined className="mr-2 text-lg gold-6" />,
  title: 'Please try again',
  description: 'No results found. Try providing more details in your question.',
});

const Understanding = makeProcessing('Understanding question');
const Searching = makeProcessing('Searching data');
const Planning = makeProcessing('Organizing thoughts');
const Generating = makeProcessing('Generating answer');
const Finished = (props: Props) => {
  const { data, onSelectResult } = props;
  // only one candidate
  const { candidates } = data;

  useEffect(() => {
    if (candidates.length) {
      const [result] = candidates;
      onSelectResult &&
        onSelectResult({ sql: result.sql, viewId: result.view?.id });
    }
  }, [data]);

  if (candidates.length === 0)
    return (
      <Wrapper>
        <NoResult {...props} />
      </Wrapper>
    );

  return null;
};

const GeneralAnswer = (props: Props) => {
  const { onClose, onSelectQuestion, data, loading } = props;
  const $wrapper = useRef<HTMLDivElement>(null);

  const { originalQuestion, askingStreamTask, recommendedQuestions } = data;
  const isDone = askingStreamTask && !loading;

  const scrollBottom = () => {
    if ($wrapper.current) {
      $wrapper.current.scrollTo({
        top: $wrapper.current.scrollHeight,
      });
    }
  };

  useEffect(() => {
    scrollBottom();
  }, [askingStreamTask]);

  useEffect(() => {
    if (isDone) scrollBottom();
  }, [isDone]);

  const recommendedQuestionProps =
    getRecommendedQuestionProps(recommendedQuestions);

  return (
    <Wrapper>
      <div className="d-flex justify-space-between">
        <div className="d-flex align-start">
          <MessageOutlined className="mr-2 mt-1 geekblue-6" />
          <b className="text-semi-bold">{originalQuestion}</b>
        </div>
        <Button
          className="adm-btn-no-style gray-7 bg-gray-3 text-sm px-2"
          type="text"
          size="small"
          onClick={onClose}
        >
          <CloseOutlined className="-mr-1" />
          Close
        </Button>
      </div>
      <div className="py-3">
        <div
          ref={$wrapper}
          className="py-2 px-3"
          style={{ maxHeight: 'calc(100vh - 420px)', overflowY: 'auto' }}
        >
          <MarkdownBlock content={askingStreamTask} />
          {isDone && (
            <div className="gray-6">
              <InfoCircleOutlined className="mr-2" />
              For the most accurate semantics, please visit the modeling page.
            </div>
          )}
        </div>
      </div>

      {recommendedQuestionProps.show && (
        <RecommendedQuestions
          {...recommendedQuestionProps.state}
          onSelect={onSelectQuestion}
        />
      )}
    </Wrapper>
  );
};

const MisleadingQuery = makeProcessingError({
  icon: <WarningOutlined className="mr-2 text-lg gold-6" />,
  title: 'Clarification needed',
});

const getGeneralAnswerStateComponent = (state: PROCESS_STATE) => {
  return (
    {
      [PROCESS_STATE.FINISHED]: GeneralAnswer,
    }[state] || null
  );
};

const getMisleadingQueryStateComponent = (state: PROCESS_STATE) => {
  return (
    {
      [PROCESS_STATE.FINISHED]: MisleadingQuery,
    }[state] || null
  );
};

const getDefaultStateComponent = (state: PROCESS_STATE) => {
  return (
    {
      [PROCESS_STATE.UNDERSTANDING]: Understanding,
      [PROCESS_STATE.SEARCHING]: Searching,
      [PROCESS_STATE.PLANNING]: Planning,
      [PROCESS_STATE.GENERATING]: Generating,
      [PROCESS_STATE.FINISHED]: Finished,
      [PROCESS_STATE.FAILED]: Failed,
    }[state] || null
  );
};

const makeProcessStateStrategy = (type: AskingTaskType) => {
  // note that the asking task type only has value when the asking status was finished
  // by default, we use the default state component (also the text to sql state component)
  if (type === AskingTaskType.GENERAL) return getGeneralAnswerStateComponent;
  if (type === AskingTaskType.MISLEADING_QUERY)
    return getMisleadingQueryStateComponent;
  return getDefaultStateComponent;
};

export default function PromptResult(props: Props) {
  const { processState, data } = props;

  const getProcessStateComponent = makeProcessStateStrategy(data?.type);
  const StateComponent = getProcessStateComponent(processState.currentState);

  if (StateComponent === null) return null;

  return <StateComponent {...props} />;
}
