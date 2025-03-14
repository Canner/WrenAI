import clsx from 'clsx';
import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { Timeline, Typography, Collapse, Button, Tag, Space } from 'antd';
import StopOutlined from '@ant-design/icons/StopOutlined';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import DownOutlined from '@ant-design/icons/DownOutlined';
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
  AskingTask,
  AskingTaskStatus,
} from '@/apollo/client/graphql/__types__';

type Props = IPromptThreadStore['preparation'] & {
  className?: string;
  data: AskingTask;
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
  const { data, onStopAskingTask } = props;
  const [stopLoading, setStopLoading] = useState(false);
  const isProcessing = !getIsFinished(data.status);

  const onCancel = (e) => {
    e.stopPropagation();
    const stopAskingTask = attachLoading(onStopAskingTask, setStopLoading);
    stopAskingTask(data.queryId);
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
  } else if (data.status === AskingTaskStatus.STOPPED) {
    return (
      <Space className="-mr-4">
        <Tag color="red">Cancelled by user</Tag>
        <Button
          icon={<ReloadOutlined />}
          className="gray-7"
          size="small"
          type="text"
        >
          Re-run
        </Button>
      </Space>
    );
  } else if (data.status === AskingTaskStatus.FINISHED) {
    return <div className="gray-6">3 steps</div>;
  }

  return null;
};

export default function Preparation(props: Props) {
  const { className, data, askingStreamTask, isAnswerPrepared } = props;
  const processState = useMemo(
    () => convertAskingTaskToProcessState(data),
    [data],
  );
  const [isActive, setIsActive] = useState(
    processState !== PROCESS_STATE.FINISHED,
  );

  // wrapping up after answer is prepared
  useEffect(() => {
    setIsActive(!isAnswerPrepared);
  }, [isAnswerPrepared]);

  if (data === null) return null;

  const showRetrieving = retrievingNextStates.includes(processState);
  const showOrganizing = organizingNextStates.includes(processState);
  const showGenerating = generatingNextStates.includes(processState);

  const isStopped = data.status === AskingTaskStatus.STOPPED;
  const retrievedTables = data.retrievedTables || [];
  const sqlGenerationReasoning =
    data.sqlGenerationReasoning || askingStreamTask || '';

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
          <Timeline className="px-1">
            {showRetrieving && (
              <Timeline.Item>
                <Retrieving
                  loading={
                    retrievedTables.length === 0 ||
                    processState === PROCESS_STATE.SEARCHING
                  }
                  tables={retrievedTables}
                />
              </Timeline.Item>
            )}
            {showOrganizing && (
              <Timeline.Item>
                <Organizing
                  loading={
                    !sqlGenerationReasoning &&
                    processState === PROCESS_STATE.PLANNING
                  }
                  stream={sqlGenerationReasoning}
                />
              </Timeline.Item>
            )}
            {showGenerating && (
              <Timeline.Item>
                <Generating
                  generating={processState === PROCESS_STATE.GENERATING}
                  correcting={processState === PROCESS_STATE.CORRECTING}
                  loading={!isAnswerPrepared}
                />
              </Timeline.Item>
            )}
          </Timeline>
        </Collapse.Panel>
      </Collapse>
    </div>
  );
}
