import { ReactNode, useMemo } from 'react';
import Link from 'next/link';
import { Row, Col, Button, Popover, Skeleton } from 'antd';
import styled from 'styled-components';
import { PROCESS_STATE, Path } from '@/utils/enum';
import { makeIterable } from '@/utils/iteration';
import CheckCircleOutlined from '@ant-design/icons/CheckCircleOutlined';
import FunctionOutlined from '@ant-design/icons/FunctionOutlined';
import CloseOutlined from '@ant-design/icons/CloseOutlined';
import StopOutlined from '@ant-design/icons/StopFilled';
import LoadingOutlined from '@ant-design/icons/LoadingOutlined';
import CloseCircleFilled from '@ant-design/icons/CloseCircleFilled';
import WarningOutlined from '@ant-design/icons/WarningOutlined';
import FileAddOutlined from '@ant-design/icons/FileAddOutlined';
import { SparklesIcon } from '@/utils/icons';
import ViewSQLModal from '@/components/pages/home/prompt/ViewSQLModal';
import EllipsisWrapper from '@/components/EllipsisWrapper';
import ErrorCollapse from '@/components/ErrorCollapse';
import useModalAction from '@/hooks/useModalAction';
import useAskProcessState, {
  getIsProcessing,
} from '@/hooks/useAskProcessState';
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

const ResultBlock = styled.div`
  user-select: none;
  overflow: hidden;
  &:hover {
    border-color: var(--geekblue-6) !important;
    transition: border-color ease 0.2s;
  }
`;

const MarkedResultBlock = styled.div`
  height: 32px;
  margin-left: -12px;
  margin-right: -12px;
  padding-top: 8px;
`;

const StyledSkeleton = styled(Skeleton)`
  margin-bottom: 22px;
  .ant-skeleton-title {
    height: 14px;
    margin-top: 4px;

    + .ant-skeleton-paragraph {
      margin-top: 20px;
      li {
        height: 14px;
        + li {
          margin-top: 8px;
        }
      }
    }
  }
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

const ResultSkeleton = () => (
  <div className="border border-gray-5 rounded px-3 pt-3 ">
    <StyledSkeleton active paragraph={{ rows: 3 }} />
  </div>
);

const ResultTemplate = ({
  index,
  summary,
  sql,
  view,
  loading,
  onSelect,
  onShowSQL,
}) => {
  const isViewSaved = !!view;

  if (loading) {
    return (
      <Col span={8}>
        <ResultSkeleton />
      </Col>
    );
  }

  return (
    <Col span={8}>
      <ResultBlock
        className="border border-gray-5 rounded px-3 pt-3 cursor-pointer"
        onClick={() => onSelect({ sql, summary, viewId: view?.id })}
      >
        <div className="d-flex justify-space-between align-center text-sm mb-3">
          <div className="border border-gray-5 px-2 rounded-pill">
            Result {index + 1}
          </div>
          <Button
            className="adm-btn-no-style gray-6 text-sm px-1"
            type="text"
            onClick={(event) => onShowSQL(event, { sql, summary })}
          >
            <FunctionOutlined className="-mr-1" />
            View SQL
          </Button>
        </div>
        <EllipsisWrapper multipleLine={3} minHeight={66} text={summary} />
        <MarkedResultBlock onClickCapture={(event) => event.stopPropagation()}>
          {isViewSaved && (
            <Popover
              trigger={['hover']}
              placement="topLeft"
              content={
                <div className="d-flex" style={{ width: 300 }}>
                  <SparklesIcon
                    className="text-md geekblue-6 mr-2"
                    style={{ marginTop: 2 }}
                  />
                  <div style={{ width: '90%', wordBreak: 'break-all' }}>
                    This search result corresponds to a saved view:{' '}
                    <Link
                      href={`${Path.Modeling}?viewId=${view.id}&openMetadata=true`}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {view.displayName}
                    </Link>
                  </div>
                </div>
              }
            >
              <div className="d-flex align-center bg-geekblue-1 geekblue-6 text-xs px-3 py-1">
                <FileAddOutlined className="text-sm mr-2" /> Result from a saved
                view
              </div>
            </Popover>
          )}
        </MarkedResultBlock>
      </ResultBlock>
    </Col>
  );
};
const ResultColumnIterator = makeIterable(ResultTemplate);
const CandidateResults = (props: Props) => {
  const { data = [], loading, onSelect } = props;

  // Remain showing 3 results when in loading mode,
  // If no data, provide loading property to result template to show skeleton
  const results = useMemo(() => {
    return loading
      ? Array.from({ length: 3 }).map((_, index) => {
          return data[index] || { loading };
        })
      : data;
  }, [data]);

  const viewSQLModal = useModalAction();

  const showSQL = (event, payload: { sql: string; summary: string }) => {
    viewSQLModal.openModal(payload);
    event.stopPropagation();
  };

  const selectResult = (payload: { sql: string; summary: string }) => {
    onSelect && onSelect(payload);
  };

  return (
    <>
      <Row gutter={[12, 12]}>
        <ResultColumnIterator
          data={results}
          onShowSQL={showSQL}
          onSelect={selectResult}
        />
      </Row>
      <ViewSQLModal {...viewSQLModal.state} onClose={viewSQLModal.closeModal} />
    </>
  );
};

const makeProcessing = (text: string) => (props: Props) => {
  const { onStop, processState } = props;
  return (
    <div>
      <div className="d-flex justify-space-between mb-3">
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
      <CandidateResults
        {...props}
        loading={getIsProcessing(processState.currentState)}
      />
    </div>
  );
};

const makeProcessingError =
  (config: { icon: ReactNode; title?: string; description?: string }) =>
  (props: Props) => {
    const { onClose, error } = props;
    const { message, shortMessage, stacktrace } = error || {};
    const hasStacktrace = !!stacktrace;
    return (
      <div>
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
      </div>
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
const Generating = makeProcessing('Generating result(s)');
const Finished = (props: Props) => {
  const { data, onClose } = props;

  if (data.length === 0) return <NoResult {...props} />;

  return (
    <div>
      <div className="d-flex justify-space-between mb-3">
        <div className="d-flex align-center text-medium">
          <CheckCircleOutlined className="mr-2 green-7 text-lg" /> {data.length}{' '}
          result(s) found
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
      <CandidateResults {...props} />
    </div>
  );
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

  return (
    <StyledResult className="border border-gray-3 rounded p-4">
      <StateComponent {...props} />
    </StyledResult>
  );
}
