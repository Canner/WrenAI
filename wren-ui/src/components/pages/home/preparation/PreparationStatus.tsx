import { useState } from 'react';
import { Button, Tag, Space } from 'antd';
import StopOutlined from '@ant-design/icons/StopOutlined';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import { attachLoading } from '@/utils/helper';
import { getIsFinished } from '@/hooks/useAskPrompt';
import { AskingTaskStatus } from '@/apollo/client/graphql/__types__';
import type { Props } from './index';

export default function PreparationStatus(props: Props) {
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
}
