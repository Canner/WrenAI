import { MouseEvent, useState } from 'react';
import { Button, Tag, Space } from 'antd';
import StopOutlined from '@ant-design/icons/StopOutlined';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import styled from 'styled-components';
import { attachLoading } from '@/utils/helper';
import { getIsFinished } from '@/hooks/useAskPrompt';
import { AskingTaskStatus } from '@/types/home';
import { type PreparationTimelineModel } from './preparationTimelineModel';

import type { Props } from './index';

const InlineStatusButton = styled(Button)`
  && {
    height: 26px;
    padding-inline: 4px;
    color: #667085;
    font-size: 11.5px;
    font-weight: 500;
  }
`;

const StatusChip = styled(Tag)`
  && {
    margin-inline-end: 0;
    border-radius: 999px;
    padding-inline: 8px;
    font-size: 11px;
    font-weight: 500;
  }
`;

export default function PreparationStatus(
  props: Props & { preparationModel: PreparationTimelineModel },
) {
  const {
    data,
    preparationModel,
    onStopAskingTask,
    onReRunAskingTask,
    onStopAdjustTask,
    onReRunAdjustTask,
  } = props;
  const [stopLoading, setStopLoading] = useState(false);
  const [reRunLoading, setReRunLoading] = useState(false);
  const preparedTask =
    preparationModel.kind === 'ask' ? preparationModel.preparedTask : null;
  const isProcessing = preparedTask
    ? !getIsFinished(preparedTask.status)
    : preparationModel.lifecycle === 'processing';

  const onCancel = (e: MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    if (!preparedTask) {
      return;
    }
    const stopPreparedTask = preparedTask.isAdjustment
      ? onStopAdjustTask
      : onStopAskingTask;
    if (!stopPreparedTask) {
      return;
    }
    const stopAskingTask = attachLoading(stopPreparedTask, setStopLoading);
    void stopAskingTask(preparedTask.queryId || undefined);
  };

  const onReRun = (e: MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    if (!preparedTask) {
      return;
    }
    const reRunPreparedTask = preparedTask.isAdjustment
      ? onReRunAdjustTask
      : onReRunAskingTask;
    if (!reRunPreparedTask) {
      return;
    }
    const reRunAskingTask = attachLoading(reRunPreparedTask, setReRunLoading);
    void reRunAskingTask(data);
  };

  if (preparedTask && isProcessing) {
    return (
      <InlineStatusButton
        icon={<StopOutlined />}
        size="small"
        type="text"
        onClick={onCancel}
        loading={stopLoading}
      >
        停止
      </InlineStatusButton>
    );
  } else if (preparedTask?.status === AskingTaskStatus.STOPPED) {
    return (
      <Space size={6}>
        <StatusChip color="red">已取消</StatusChip>
        <InlineStatusButton
          icon={<ReloadOutlined />}
          size="small"
          type="text"
          onClick={onReRun}
          loading={reRunLoading}
        >
          重试
        </InlineStatusButton>
      </Space>
    );
  } else if (preparationModel.lifecycle === 'processing') {
    return <StatusChip color="processing">进行中</StatusChip>;
  }

  return null;
}
