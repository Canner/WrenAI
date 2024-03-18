import { ReactNode } from 'react';
import { Row, Col, Button } from 'antd';
import styled from 'styled-components';
import { PROCESS_STATE } from '@/utils/enum';
import { makeIterable } from '@/utils/iteration';
import CheckCircleOutlined from '@ant-design/icons/CheckCircleOutlined';
import FunctionOutlined from '@ant-design/icons/FunctionOutlined';
import CloseOutlined from '@ant-design/icons/CloseOutlined';
import StopOutlined from '@ant-design/icons/StopFilled';
import LoadingOutlined from '@ant-design/icons/LoadingOutlined';
import CloseCircleFilled from '@ant-design/icons/CloseCircleFilled';
import WarningOutlined from '@ant-design/icons/WarningOutlined';
import ViewSQLModal from '@/components/pages/home/prompt/ViewSQLModal';
import EllipsisWrapper from '@/components/EllipsisWrapper';
import useModalAction from '@/hooks/useModalAction';
import useAskProcessState from '@/hooks/useAskProcessState';

const ResultStyle = styled.div`
  position: absolute;
  bottom: calc(100% + 12px);
  left: 0;
  width: 100%;
`;

interface Props {
  processState: ReturnType<typeof useAskProcessState>;
  data: any[];
  error?: any;
  onClose: () => void;
  onStop: () => void;
}

const BlockTemplate = ({ index, summary, sql, onShowSQL }) => {
  return (
    <Col span={8}>
      <div className="border border-gray-5 rounded px-3 pt-3 pb-4 cursor-pointer">
        <div className="d-flex justify-space-between align-center text-sm mb-3">
          <div className="border border-gray-5 px-2 rounded-pill">
            Result {index + 1}
          </div>
          <Button
            className="adm-btn-no-style gray-6 text-sm px-1"
            type="text"
            onClick={() => onShowSQL({ sql, summary })}
          >
            <FunctionOutlined className="-mr-1" />
            View SQL
          </Button>
        </div>
        <EllipsisWrapper multipleLine={3} text={summary} />
      </div>
    </Col>
  );
};

const makeProcessing = (text: string) => (props: Props) => {
  const { onStop } = props;
  return (
    <div className="d-flex justify-space-between">
      <span>
        <LoadingOutlined className="mr-2 geekblue-6 text-lg" spin />
        {text}
      </span>
      <Button
        className="adm-btn-no-style gray-7 bg-gray-3 px-2"
        type="text"
        onClick={onStop}
      >
        <StopOutlined className="-mr-1" />
        Stop
      </Button>
    </div>
  );
};

const makeProcessingError =
  (config: { icon: ReactNode; title: string; description: string }) =>
  (props: Props) => {
    const { onClose } = props;
    return (
      <div>
        <div className="d-flex justify-space-between text-medium mb-2">
          <div className="d-flex align-center">
            {config.icon}
            {config.title}
          </div>
          <Button
            className="adm-btn-no-style gray-7 bg-gray-3 px-2"
            type="text"
            onClick={onClose}
          >
            <CloseOutlined className="-mr-1" />
            Close
          </Button>
        </div>
        <div className="gray-7">{config.description}</div>
      </div>
    );
  };

const ErrorIcon = () => <CloseCircleFilled className="mr-2 red-5 text-lg" />;

const UnderstandingFailed = makeProcessingError({
  icon: <ErrorIcon />,
  title: 'Failed to understand',
  description:
    'Sorry, I cannot understand your question. Could you please rephrase your question or provide more context?',
});

const SearchingFailed = makeProcessingError({
  icon: <ErrorIcon />,
  title: 'Something when wrong',
  description:
    "Sorry, we encountered an error when we're processing your request.",
});

const NoResult = makeProcessingError({
  icon: <WarningOutlined className="mr-2 text-lg" />,
  title: 'Please try again',
  description: 'No results found. Try providing more details in your question.',
});

const Understanding = makeProcessing('Understanding question');
const Searching = makeProcessing('Searching data');
const Finished = (props: Props) => {
  const { data, onClose } = props;

  const viewSQLModal = useModalAction();

  const showSQL = (payload: { sql: string; summary: string }) => {
    viewSQLModal.openModal(payload);
  };
  const ResultColumns = makeIterable(BlockTemplate);

  return (
    <div>
      <div className="d-flex justify-space-between mb-3">
        <div className="d-flex align-center text-medium">
          <CheckCircleOutlined className="mr-2 green-7 text-lg" /> {data.length}{' '}
          result(s) found
        </div>
        <Button
          className="adm-btn-no-style gray-7 bg-gray-3 px-2"
          type="text"
          onClick={onClose}
        >
          <CloseOutlined className="-mr-1" />
          Close
        </Button>
      </div>
      <Row gutter={12}>
        <ResultColumns data={data} onShowSQL={showSQL} />
      </Row>
      <ViewSQLModal {...viewSQLModal.state} onClose={viewSQLModal.closeModal} />
    </div>
  );
};

const getProcessStateComponent = (state: PROCESS_STATE) => {
  return (
    {
      [PROCESS_STATE.UNDERSTANDING]: Understanding,
      [PROCESS_STATE.SEARCHING]: Searching,
      [PROCESS_STATE.FINISHED]: Finished,
      [PROCESS_STATE.UNDERSTANDING_FAILED]: UnderstandingFailed,
      [PROCESS_STATE.SEARCHING_FAILED]: SearchingFailed,
      [PROCESS_STATE.NO_RESULT]: NoResult,
    }[state] || null
  );
};

export default function PromptResult(props: Props) {
  const { processState } = props;

  const StateComponent = getProcessStateComponent(processState.currentState);

  if (StateComponent === null) return null;

  return (
    <ResultStyle className="border border-gray-3 rounded p-4">
      <StateComponent {...props} />
    </ResultStyle>
  );
}
