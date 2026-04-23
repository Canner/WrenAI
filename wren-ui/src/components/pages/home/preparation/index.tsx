import clsx from 'clsx';
import Image from 'next/image';
import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { Typography, Collapse } from 'antd';
import type { CollapseProps } from 'antd';
import DownOutlined from '@ant-design/icons/DownOutlined';
import styled from 'styled-components';
import ErrorBoundary from './ErrorBoundary';
import PreparationStatus from './PreparationStatus';
import PreparationSteps from './PreparationSteps';
import {
  getPreparationStepCountLabel,
  resolvePreparationTimelineModel,
} from './preparationTimelineModel';
import { IPromptThreadStore } from '@/components/pages/home/promptThread/store';
import {
  ThreadResponse,
  AskingTaskStatus,
  AskingTask,
  AdjustmentTask,
} from '@/types/home';

const PreparationShell = styled.div`
  width: 100%;

  .ant-collapse {
    background: transparent;
    border: 0;
  }

  .ant-collapse-item {
    border: 0 !important;
  }

  .ant-collapse-header {
    padding: 0 !important;
  }

  .ant-collapse-content {
    border-top: 0 !important;
    background: transparent;
  }

  .ant-collapse-content-box {
    padding: 8px 0 0 !important;
  }
`;

const PreparationHeaderRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
`;

const PreparationTrigger = styled.div<{ $active: boolean }>`
  flex: 1;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 0 12px;
  border-radius: 14px;
  border: 1px solid
    ${(props) =>
      props.$active ? 'rgba(111, 71, 255, 0.12)' : 'rgba(15, 23, 42, 0.05)'};
  background: ${(props) =>
    props.$active
      ? 'linear-gradient(90deg, rgba(111, 71, 255, 0.08) 0%, rgba(236, 72, 153, 0.04) 52%, rgba(255, 255, 255, 0.92) 100%)'
      : 'linear-gradient(90deg, rgba(248, 250, 252, 0.92) 0%, rgba(255, 255, 255, 0.92) 100%)'};
  color: ${(props) => (props.$active ? '#4c1d95' : '#5b6475')};
`;

const PreparationTriggerLabel = styled(Typography.Text)`
  && {
    margin-bottom: 0;
    color: inherit;
    font-size: 12.5px;
    font-weight: 600;
  }
`;

const PreparationStepPill = styled.span`
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 7px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.86);
  color: #667085;
  font-size: 11px;
  font-weight: 500;
`;

const PreparationPanel = styled.div`
  margin-top: 6px;
  margin-left: 12px;
  padding-left: 16px;
  border-left: 1px solid rgba(15, 23, 42, 0.06);
`;

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

  const preparationModel = useMemo(
    () =>
      resolvePreparationTimelineModel({
        askingStreamTask: props.askingStreamTask,
        data,
        preparedTask,
      }),
    [props.askingStreamTask, data, preparedTask],
  );

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

  if (preparationModel === null) return null;

  const isStopped =
    preparationModel.kind === 'ask' &&
    preparationModel.preparedTask.status === AskingTaskStatus.STOPPED;
  const triggerLabel =
    preparationModel.lifecycle === 'processing' && isActive
      ? preparationModel.title
      : isActive
        ? '思考步骤'
        : '查看思考步骤';
  const items: CollapseProps['items'] = [
    {
      key: 'preparation',
      label: (
        <PreparationHeaderRow className="select-none">
          <PreparationTrigger $active={isActive && !isStopped}>
            <Image
              src="/images/icon/message-ai.svg"
              alt={preparationModel.title}
              width={18}
              height={18}
            />
            <PreparationTriggerLabel>{triggerLabel}</PreparationTriggerLabel>
            <PreparationStepPill>
              {getPreparationStepCountLabel(preparationModel)}
            </PreparationStepPill>
          </PreparationTrigger>
          <PreparationStatus {...props} preparationModel={preparationModel} />
        </PreparationHeaderRow>
      ),
      children: (
        <PreparationPanel>
          <ErrorBoundary error={error}>
            <PreparationSteps
              {...props}
              preparationModel={preparationModel}
              className="px-1 -mb-4"
            />
          </ErrorBoundary>
        </PreparationPanel>
      ),
    },
  ];

  return (
    <PreparationShell className={clsx(className)}>
      <Collapse
        ghost
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
    </PreparationShell>
  );
}
