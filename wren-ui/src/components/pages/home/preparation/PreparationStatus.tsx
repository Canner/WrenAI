import { useState } from 'react';
import { Button, Tag, Space } from 'antd';
import StopOutlined from '@ant-design/icons/StopOutlined';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import { attachLoading } from '@/utils/helper';
import { getIsFinished } from '@/hooks/useAskPrompt';
import { AskingTaskStatus } from '@/apollo/client/graphql/__types__';
import type { PreparedTask, Props } from './index';

export default function PreparationStatus(
  props: Props & { preparedTask: PreparedTask },
) {
  const {
    data,
    preparedTask,
    onStopAskingTask,
    onReRunAskingTask,
    onStopAdjustTask,
    onReRunAdjustTask,
  } = props;
  const [stopLoading, setStopLoading] = useState(false);
  const [reRunLoading, setReRunLoading] = useState(false);
  const isProcessing = !getIsFinished(preparedTask.status);

  const onCancel = (e) => {
    e.stopPropagation();
    const stopPreparedTask = preparedTask.isAdjustment
      ? onStopAdjustTask
      : onStopAskingTask;
    const stopAskingTask = attachLoading(stopPreparedTask, setStopLoading);
    stopAskingTask(preparedTask.queryId);
  };

  const onReRun = (e) => {
    e.stopPropagation();
    const reRunPreparedTask = preparedTask.isAdjustment
      ? onReRunAdjustTask
      : onReRunAskingTask;
    const reRunAskingTask = attachLoading(reRunPreparedTask, setReRunLoading);
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
  } else if (preparedTask.status === AskingTaskStatus.STOPPED) {
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
  } else if (preparedTask.status === AskingTaskStatus.FINISHED) {
    const showView = data.view !== null;
    const showSqlPair = !!preparedTask?.candidates[0]?.sqlPair;
    return (
      <div className="gray-6">
        {showView || showSqlPair ? '1 step' : '3 steps'}
      </div>
    );
  }

  return null;
}
