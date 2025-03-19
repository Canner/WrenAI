import clsx from 'clsx';
import Image from 'next/image';
import styled from 'styled-components';
import { useEffect, useMemo, useState } from 'react';
import {
  Timeline,
  Typography,
  Collapse,
  Button,
  Tag,
  Space,
  Badge,
} from 'antd';
import StopOutlined from '@ant-design/icons/StopOutlined';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import DownOutlined from '@ant-design/icons/DownOutlined';
import ErrorBoundary from './ErrorBoundary';
import Retrieving from './step/Retrieving';
import Organizing from './step/Organizing';
import Generating from './step/Generating';
import { PROCESS_STATE } from '@/utils/enum';
import { attachLoading } from '@/utils/helper';
import { getIsFinished } from '@/hooks/useAskPrompt';
import {
  ProcessStateMachine,
  convertAskingTaskToProcessState,
} from '@/hooks/useAskProcessState';
import { IPromptThreadStore } from '@/components/pages/home/promptThread/store';
import {
  ThreadResponse,
  AskingTaskStatus,
} from '@/apollo/client/graphql/__types__';

const StyledBadge = styled(Badge)`
  position: absolute;
  top: -5px;
  left: -3px;
  .ant-badge-status-dot {
    width: 7px;
    height: 7px;
  }
  .ant-badge-status-text {
    display: none;
  }
`;

type Props = IPromptThreadStore['preparation'] & {
  className?: string;
  data: ThreadResponse;
  isAnswerPrepared?: boolean;
};

const retrievingNextStates = ProcessStateMachine.getAllNextStates(
  PROCESS_STATE.SEARCHING,
  true,
);
const organizingNextStates = ProcessStateMachine.getAllNextStates(
  PROCESS_STATE.PLANNING,
  true,
);
const generatingNextStates = ProcessStateMachine.getAllNextStates(
  PROCESS_STATE.GENERATING,
  true,
);

const PreparationStatus = (props: Props) => {
  const { data, onStopAskingTask, onReRunAskingTask } = props;
  const [stopLoading, setStopLoading] = useState(false);
  const [reRunLoading, setReRunLoading] = useState(false);
  const { askingTask } = data;
  const isProcessing = !getIsFinished(askingTask.status);

  const onCancel = (e) => {
    e.stopPropagation();
    const stopAskingTask = attachLoading(onStopAskingTask, setStopLoading);
    stopAskingTask(askingTask.queryId);
  };

  const onReRun = (e) => {
    e.stopPropagation();
    const reRunAskingTask = attachLoading(onReRunAskingTask, setReRunLoading);
    reRunAskingTask(data);
  };

  if (isProcessing) {
    return (
      <Button
        icon={<StopOutlined />}
        danger
        size="small"
        onClick={onCancel}
        loading={stopLoading}
      >
        Cancel
      </Button>
    );
  } else if (askingTask.status === AskingTaskStatus.STOPPED) {
    return (
      <Space className="-mr-4">
        <Tag color="red">Cancelled by user</Tag>
        <Button
          icon={<ReloadOutlined />}
          className="gray-7"
          size="small"
          type="text"
          onClick={onReRun}
          loading={reRunLoading}
        >
          Re-run
        </Button>
      </Space>
    );
  } else if (askingTask.status === AskingTaskStatus.FINISHED) {
    const showView = data.view !== null;
    return <div className="gray-6">{showView ? '1 step' : '3 steps'}</div>;
  }

  return null;
};

const getProcessDot = (processing: boolean) => {
  return processing ? (
    <StyledBadge color="geekblue" status="processing" />
  ) : null;
};

export default function Preparation(props: Props) {
  const { className, data, askingStreamTask, isAnswerPrepared } = props;
  const { askingTask, view } = data;

  const processState = useMemo(
    () => convertAskingTaskToProcessState(askingTask),
    [askingTask],
  );
  const [isActive, setIsActive] = useState(
    processState !== PROCESS_STATE.FINISHED,
  );

  // wrapping up after answer is prepared
  useEffect(() => {
    setIsActive(!isAnswerPrepared);
  }, [isAnswerPrepared]);
  const error = useMemo(() => {
    return askingTask?.error
      ? { ...askingTask.error, invalidSql: askingTask.invalidSql }
      : null;
  }, [askingTask?.error, askingTask?.invalidSql]);

  if (askingTask === null) return null;

  // displays
  const showView = !!view;
  // General steps
  const showRetrieving =
    retrievingNextStates.includes(processState) && !showView;
  const showOrganizing =
    organizingNextStates.includes(processState) && !showView;
  const showGenerating =
    generatingNextStates.includes(processState) && !showView;

  // data
  const isStopped = askingTask.status === AskingTaskStatus.STOPPED;
  const retrievedTables = askingTask.retrievedTables || [];
  const sqlGenerationReasoning =
    askingTask.sqlGenerationReasoning || askingStreamTask || '';

  // loadings
  const retrieving = processState === PROCESS_STATE.SEARCHING;
  const organizing = processState === PROCESS_STATE.PLANNING;
  const generating = processState === PROCESS_STATE.GENERATING;
  const correcting = processState === PROCESS_STATE.CORRECTING;
  const wrapping = !isAnswerPrepared;

  return (
    <div className={clsx('border border-gray-4 rounded', className)}>
      <Collapse
        className="bg-gray-1"
        bordered={false}
        expandIconPosition="right"
        expandIcon={({ isActive }) =>
          !isStopped && (
            <DownOutlined
              className="gray-6 text-sm"
              rotate={isActive ? 180 : 0}
            />
          )
        }
        activeKey={isActive && !isStopped ? 'preparation' : undefined}
        onChange={([key]) => setIsActive(key === 'preparation')}
      >
        <Collapse.Panel
          key="preparation"
          header={
            <div className="flex-grow-1 d-flex align-center justify-space-between gx-2 select-none">
              <Typography.Title level={5} className="gray-8 text-medium mb-0">
                <Image
                  src="/images/icon/message-ai.svg"
                  alt="Answer Preparation Steps"
                  width={24}
                  height={24}
                  className="mr-1"
                />
                Answer preparation steps
              </Typography.Title>
              <PreparationStatus {...props} />
            </div>
          }
        >
          <ErrorBoundary error={error}>
            <Timeline className="px-1 -mb-4">
              {showView && (
                <Timeline.Item>
                  <Typography.Text className="gray-8">
                    Using pre-saved view
                  </Typography.Text>
                  <div className="gray-7 text-sm mt-1">
                    <div>
                      Matching saved view found. Returning results instantly.
                    </div>
                  </div>
                </Timeline.Item>
              )}

              {/* General steps */}
              {showRetrieving && (
                <Timeline.Item dot={getProcessDot(retrieving)}>
                  <Retrieving loading={retrieving} tables={retrievedTables} />
                </Timeline.Item>
              )}
              {showOrganizing && (
                <Timeline.Item dot={getProcessDot(organizing)}>
                  <Organizing
                    loading={organizing}
                    stream={sqlGenerationReasoning}
                  />
                </Timeline.Item>
              )}
              {showGenerating && (
                <Timeline.Item dot={getProcessDot(generating || correcting)}>
                  <Generating
                    generating={generating}
                    correcting={correcting}
                    loading={wrapping}
                  />
                </Timeline.Item>
              )}
            </Timeline>
          </ErrorBoundary>
        </Collapse.Panel>
      </Collapse>
    </div>
  );
}
