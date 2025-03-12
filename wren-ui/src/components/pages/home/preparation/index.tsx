import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Timeline, Typography, Collapse } from 'antd';
import DownOutlined from '@ant-design/icons/DownOutlined';
import Retrieving from './step/Retrieving';
import Organizing from './step/Organizing';
import Generating from './step/Generating';
import { PROCESS_STATE } from '@/utils/enum';
import useAskProcessState, {
  ProcessStateMachine,
  convertAskingTaskToProcessState,
} from '@/hooks/useAskProcessState';
import { AskingTask } from '@/apollo/client/graphql/__types__';

interface Props {
  className?: string;
  data: AskingTask;
}

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

export default function Preparation(props: Props) {
  const { className, data } = props;
  const askProcessState = useAskProcessState();
  const [isActive, setIsActive] = useState(false);

  const processState = useMemo(
    () => (data ? convertAskingTaskToProcessState(data) : PROCESS_STATE.PLANNING),
    [data],
  );

  useEffect(() => {
    setIsActive(!askProcessState.isFinished());
  }, [processState])

  const showRetrieving = retrievingNextStates.includes(processState);
  const showOrganizing = organizingNextStates.includes(processState);
  const showGenerating = generatingNextStates.includes(processState);

  if (processState === null) return null;
  return (
    <div className={clsx('border border-gray-4 rounded', className)}>
      <Collapse
        className="bg-gray-1"
        bordered={false}
        expandIconPosition="right"
        expandIcon={({ isActive }) => (
          <DownOutlined
            className="gray-6 text-sm"
            rotate={isActive ? 180 : 0}
          />
        )}
        activeKey={isActive ? 'preparation' : undefined}
        onChange={([key]) => setIsActive(key === 'preparation')}
      >
        <Collapse.Panel
          key="preparation"
          header={
            <Typography.Title
              level={5}
              className="gray-8 text-medium mb-0 select-none"
            >
              <Image
                src="/images/icon/message-ai.svg"
                alt="Answer Preparation Steps"
                width={24}
                height={24}
                className="mr-1"
              />
              Answer preparation steps
            </Typography.Title>
          }
        >
          <Timeline className="px-1">
            {showRetrieving && (
              <Timeline.Item>
                <Retrieving
                  loading={processState === PROCESS_STATE.SEARCHING}
                  tables={['Customer', 'Orders', 'Reviews']}
                />
              </Timeline.Item>
            )}
            {showOrganizing && (
              <Timeline.Item>
                <Organizing
                  loading={processState === PROCESS_STATE.PLANNING}
                  stream={
                    'SQL generation steps created\n1. Join Customer, orders by id \n2. Join aggregated results with reviews \n3. Filter results with createdAt between 2025-01-23 ~ 2025-01 \n4. Sort results by id'
                  }
                />
              </Timeline.Item>
            )}
            {showGenerating && (
              <Timeline.Item>
                <Generating
                  generating={processState === PROCESS_STATE.GENERATING}
                  correcting={processState === PROCESS_STATE.CORRECTING}
                  loading={true}
                />
              </Timeline.Item>
            )}
          </Timeline>
        </Collapse.Panel>
      </Collapse>
    </div>
  );
}
