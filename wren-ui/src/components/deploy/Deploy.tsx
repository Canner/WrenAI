import { useEffect, useState } from 'react';
import { Button, Space, Typography, message } from 'antd';
import CheckCircleOutlined from '@ant-design/icons/CheckCircleOutlined';
import LoadingOutlined from '@ant-design/icons/LoadingOutlined';
import WarningOutlined from '@ant-design/icons/WarningOutlined';
import { SyncStatus } from '@/types/project';
import { resolveAbortSafeErrorMessage } from '@/utils/abort';

import { useDeployStatusContext } from '@/components/deploy/Context';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { deployCurrentRuntime } from '@/utils/modelingRest';

const { Text } = Typography;

const getDeployStatus = (deploying: boolean, status: SyncStatus) => {
  const syncStatus = deploying ? SyncStatus.IN_PROGRESS : status;

  return (
    {
      [SyncStatus.IN_PROGRESS]: (
        <Space size={[4, 0]}>
          <LoadingOutlined className="mr-1 gray-1" />
          <Text className="gray-1">Deploying...</Text>
        </Space>
      ),
      [SyncStatus.SYNCRONIZED]: (
        <Space size={[4, 0]}>
          <CheckCircleOutlined className="mr-1 green-7" />
          <Text className="gray-1">Synced</Text>
        </Space>
      ),
      [SyncStatus.UNSYNCRONIZED]: (
        <Space size={[4, 0]}>
          <WarningOutlined className="mr-1 gold-6" />
          <Text className="gray-1">Undeployed changes</Text>
        </Space>
      ),
    }[syncStatus] || ''
  );
};

export default function Deploy() {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const deployContext = useDeployStatusContext();
  const { data, loading, startPolling, stopPolling } = deployContext;
  const [messageApi, contextHolder] = message.useMessage();
  const [deploying, setDeploying] = useState(false);
  const [deployFailed, setDeployFailed] = useState(false);

  useEffect(() => {
    // Stop polling deploy status if deploy failed
    if (deployFailed && data?.modelSync.status === SyncStatus.UNSYNCRONIZED) {
      stopPolling();
    }
  }, [data, deployFailed, stopPolling]);

  const syncStatus = data?.modelSync.status ?? SyncStatus.UNSYNCRONIZED;

  const onDeploy = async () => {
    setDeploying(true);
    setDeployFailed(false);
    startPolling(1000);
    try {
      const result = await deployCurrentRuntime(
        runtimeScopeNavigation.selector,
      );
      if (result?.status === 'FAILED') {
        setDeployFailed(true);
        messageApi.error(
          result.error ||
            'Failed to deploy. Please check the log for more details.',
        );
      }
    } catch (error) {
      setDeployFailed(true);
      const errorMessage = resolveAbortSafeErrorMessage(
        error,
        '部署失败，请稍后重试。',
      );
      if (errorMessage) {
        messageApi.error(errorMessage);
      }
    } finally {
      setDeploying(false);
    }
  };

  useEffect(() => {
    if (syncStatus === SyncStatus.SYNCRONIZED) stopPolling();
  }, [syncStatus]);

  const disabled =
    deploying ||
    loading ||
    [SyncStatus.SYNCRONIZED, SyncStatus.IN_PROGRESS].includes(syncStatus);

  return (
    <>
      {contextHolder}
      <Space size={[8, 0]}>
        {getDeployStatus(deploying, syncStatus)}
        <Button
          className={`adm-modeling-header-btn ${disabled ? '' : 'gray-10'}`}
          disabled={disabled}
          onClick={() => onDeploy()}
          size="small"
          data-guideid="deploy-model"
        >
          Deploy
        </Button>
      </Space>
    </>
  );
}
