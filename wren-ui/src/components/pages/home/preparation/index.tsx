import clsx from 'clsx';
import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { Typography, Collapse } from 'antd';
import DownOutlined from '@ant-design/icons/DownOutlined';
import ErrorBoundary from './ErrorBoundary';
import PreparationStatus from './PreparationStatus';
import PreparationSteps from './PreparationSteps';
import { IPromptThreadStore } from '@/components/pages/home/promptThread/store';
import {
  ThreadResponse,
  AskingTaskStatus,
} from '@/apollo/client/graphql/__types__';

export type Props = IPromptThreadStore['preparation'] & {
  className?: string;
  data: ThreadResponse;
  isAnswerFinished?: boolean;
};

export default function Preparation(props: Props) {
  const { className, data, isAnswerFinished, onFixSQLStatement } = props;
  const { askingTask, id: responseId, sql } = data;

  const [isActive, setIsActive] = useState(!sql);

  // wrapping up after answer is prepared
  useEffect(() => {
    setIsActive(!isAnswerFinished);
  }, [isAnswerFinished]);
  const error = useMemo(() => {
    return askingTask?.error && !sql
      ? {
          ...askingTask.error,
          invalidSql: askingTask.invalidSql,
          fixStatement: (sql: string) => onFixSQLStatement(responseId, sql),
        }
      : null;
  }, [askingTask?.error, askingTask?.invalidSql, responseId, sql]);

  if (askingTask === null) return null;

  const isStopped = askingTask.status === AskingTaskStatus.STOPPED;

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
            <PreparationSteps {...props} className="px-1 -mb-4" />
          </ErrorBoundary>
        </Collapse.Panel>
      </Collapse>
    </div>
  );
}
