import clsx from 'clsx';
import Image from 'next/image';
import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { Typography, Collapse } from 'antd';
import type { CollapseProps } from 'antd';
import DownOutlined from '@ant-design/icons/DownOutlined';
import ErrorBoundary from './ErrorBoundary';
import PreparationStatus from './PreparationStatus';
import PreparationSteps from './PreparationSteps';
import { IPromptThreadStore } from '@/components/pages/home/promptThread/store';
import {
  ThreadResponse,
  AskingTaskStatus,
  AskingTask,
  AdjustmentTask,
} from '@/types/home';

export type Props = IPromptThreadStore['preparation'] & {
  className?: string;
  data: ThreadResponse;
  minimized?: boolean;
};

export type PreparedTask = AskingTask &
  AdjustmentTask & { isAdjustment: boolean };

export default function Preparation(props: Props) {
  const { className, data, minimized, onFixSQLStatement, fixStatementLoading } =
    props;
  const { askingTask, adjustmentTask, adjustment, id: responseId, sql } = data;

  const [isActive, setIsActive] = useState(!sql);

  // Adapt askingTask and adjustmentTask for preparation steps
  const preparedTask = useMemo(() => {
    if (askingTask === null && adjustmentTask === null) return null;
    const { payload } = adjustment || {};
    return {
      candidates: [],
      invalidSql: '',
      retrievedTables: payload?.retrievedTables || [],
      sqlGenerationReasoning: payload?.sqlGenerationReasoning || '',
      isAdjustment: !!adjustmentTask,
      ...(askingTask || {}),
      ...(adjustmentTask || {}),
    } as PreparedTask;
  }, [askingTask?.status, adjustmentTask?.status, adjustment?.payload]);

  // wrapping up after answer is prepared
  useEffect(() => {
    setIsActive(!minimized);
  }, [minimized]);
  const error = useMemo<ComponentProps<typeof ErrorBoundary>['error']>(() => {
    return preparedTask?.error && !sql && onFixSQLStatement
      ? {
          ...preparedTask.error,
          message: preparedTask.error.message || '回答生成失败',
          shortMessage: preparedTask.error.shortMessage || '回答生成失败',
          invalidSql: preparedTask?.invalidSql || undefined,
          fixStatement: (sql: string) => onFixSQLStatement(responseId, sql),
          fixStatementLoading,
        }
      : undefined;
  }, [preparedTask, responseId, sql, fixStatementLoading, onFixSQLStatement]);

  if (preparedTask === null) return null;

  const isStopped = preparedTask.status === AskingTaskStatus.STOPPED;
  const items: CollapseProps['items'] = [
    {
      key: 'preparation',
      label: (
        <div className="flex-grow-1 d-flex align-center justify-space-between gx-2 select-none">
          <Typography.Title level={5} className="gray-8 text-medium mb-0">
            <Image
              src="/images/icon/message-ai.svg"
              alt="回答准备步骤"
              width={24}
              height={24}
              className="mr-1"
            />
            回答准备步骤
          </Typography.Title>
          <PreparationStatus {...props} preparedTask={preparedTask} />
        </div>
      ),
      children: (
        <ErrorBoundary error={error}>
          <PreparationSteps
            {...props}
            preparedTask={preparedTask}
            className="px-1 -mb-4"
          />
        </ErrorBoundary>
      ),
    },
  ];

  return (
    <div className={clsx('border border-gray-4 rounded', className)}>
      <Collapse
        className="bg-gray-1"
        bordered={false}
        items={items}
        expandIconPlacement="end"
        expandIcon={({ isActive }) =>
          !isStopped && (
            <DownOutlined
              className="gray-6 text-sm"
              rotate={isActive ? 180 : 0}
            />
          )
        }
        activeKey={isActive && !isStopped ? ['preparation'] : []}
        onChange={(key) => {
          const keys = Array.isArray(key) ? key : key ? [key] : [];
          setIsActive(keys.includes('preparation'));
        }}
      />
    </div>
  );
}
