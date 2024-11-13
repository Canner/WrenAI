import { ReactNode, useEffect } from 'react';
import { Button } from 'antd';
import styled from 'styled-components';
import { PROCESS_STATE } from '@/utils/enum';
import CloseOutlined from '@ant-design/icons/CloseOutlined';
import StopOutlined from '@ant-design/icons/StopFilled';
import LoadingOutlined from '@ant-design/icons/LoadingOutlined';
import CloseCircleFilled from '@ant-design/icons/CloseCircleFilled';
import WarningOutlined from '@ant-design/icons/WarningOutlined';
import ErrorCollapse from '@/components/ErrorCollapse';
import useAskProcessState from '@/hooks/useAskProcessState';
import { AskingTask } from '@/apollo/client/graphql/__types__';

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
  data: AskingTask['candidates'];
  error?: any;
  onSelect: (payload: { sql: string; summary: string }) => void;
  onClose: () => void;
  onStop: () => void;
  loading?: boolean;
}

const Wrapper = ({ children }) => {
  return (
    <StyledResult className="border border-gray-3 rounded p-4">
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
    const { onClose, error } = props;
    const { message, shortMessage, stacktrace } = error || {};
    const hasStacktrace = !!stacktrace;
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
        <div className="gray-7">{config.description || message}</div>
        {hasStacktrace && (
          <ErrorCollapse className="mt-2" message={stacktrace.join('\n')} />
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
const Generating = makeProcessing('Generating answer');
const Finished = (props: Props) => {
  const { data, onSelect } = props;

  useEffect(() => {
    if (data.length) {
      const [result] = data;
      onSelect && onSelect({ sql: result.sql, summary: result.summary });
    }
  }, [data]);

  if (data.length === 0)
    return (
      <Wrapper>
        <NoResult {...props} />
      </Wrapper>
    );
  return null;
};

const getProcessStateComponent = (state: PROCESS_STATE) => {
  return (
    {
      [PROCESS_STATE.UNDERSTANDING]: Understanding,
      [PROCESS_STATE.SEARCHING]: Searching,
      [PROCESS_STATE.GENERATING]: Generating,
      [PROCESS_STATE.FINISHED]: Finished,
      [PROCESS_STATE.FAILED]: Failed,
    }[state] || null
  );
};

export default function PromptResult(props: Props) {
  const { processState } = props;

  const StateComponent = getProcessStateComponent(processState.currentState);

  if (StateComponent === null) return null;

  return <StateComponent {...props} />;
}
