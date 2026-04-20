import Image from 'next/image';
import { SampleDatasetName, DataSourceName } from '@/types/dataSource';
import { useEffect, useState } from 'react';
import { Button, Form, message, Alert } from 'antd';
import { DATA_SOURCES, FORM_MODE, Path } from '@/utils/enum';
import { getConnectionType } from '@/components/pages/setup/utils';
import { FlexLoading } from '@/components/PageLoading';
import {
  transformConnectionFormToProperties,
  transformConnectionPropertiesToForm,
} from '@/hooks/useSetupConnectionType';
import { isAbortRequestError } from '@/utils/abort';
import { updateKnowledgeConnectionSettings } from '@/utils/settingsRest';

import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { clearRuntimePagePrefetchCache } from '@/utils/runtimePagePrefetch';

interface Props {
  type: DataSourceName;
  properties: Record<string, any>;
  sampleDataset: SampleDatasetName | null;
  refetchSettings: () => Promise<unknown>;
  closeModal: () => void;
}

const SampleDatasetPanel = (props: Props) => {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const { sampleDataset, closeModal } = props;

  return (
    <>
      <Alert
        showIcon
        type="info"
        message="样例数据已统一迁移到系统样例空间"
        description={`当前作用域仍记录了样例数据集「${sampleDataset}」。业务工作区不再支持切换或导入样例库；如需体验示例，请前往系统样例空间，正式业务请直接配置真实数据库连接。`}
      />
      <div className="mt-4">
        <Button
          type="primary"
          onClick={() => {
            clearRuntimePagePrefetchCache();
            runtimeScopeNavigation.pushWorkspace(Path.Home);
            closeModal();
          }}
        >
          返回主界面
        </Button>
      </div>
    </>
  );
};

const ConnectionPanel = (props: Props) => {
  const { type, properties, refetchSettings } = props;
  const managedFederatedRuntime = Boolean(
    properties?.managedFederatedRuntime && type === DataSourceName.TRINO,
  );

  const current = getConnectionType(type as unknown as DATA_SOURCES);
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const [form] = Form.useForm();
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<Error | null>(null);

  useEffect(() => {
    if (properties) {
      form.setFieldsValue(
        transformConnectionPropertiesToForm(properties, type),
      );
    }
  }, [form, properties, type]);

  const reset = () => {
    form.setFieldsValue(transformConnectionPropertiesToForm(properties, type));
  };

  const submit = () => {
    form
      .validateFields()
      .then(async (values) => {
        try {
          setUpdating(true);
          setUpdateError(null);
          await updateKnowledgeConnectionSettings(
            runtimeScopeNavigation.selector,
            {
              type,
              properties: transformConnectionFormToProperties(values, type),
            },
          );
          await refetchSettings();
          message.success('知识库连接已更新。');
        } catch (error) {
          const normalizedError =
            error instanceof Error
              ? error
              : new Error('更新知识库连接失败，请稍后重试。');
          if (isAbortRequestError(normalizedError)) {
            return;
          }
          setUpdateError(normalizedError);
          message.error(normalizedError.message);
        } finally {
          setUpdating(false);
        }
      })
      .catch(() => {
        // form validation errors are displayed by antd fields
      });
  };

  if (!type) return <FlexLoading align="center" height={150} />;

  if (managedFederatedRuntime) {
    return (
      <>
        <div className="d-flex align-center">
          <Image
            className="mr-2"
            src={current.logo || ''}
            alt={current.label}
            width="24"
            height="24"
          />
          {current.label}
        </div>
        <Alert
          className="mt-4"
          type="info"
          showIcon
          message="当前连接由系统自动维护"
          description={
            properties?.readonlyReason ||
            '当前连接由多连接器聚合运行时自动维护，请前往知识库 → 连接器维护。'
          }
        />
      </>
    );
  }

  return (
    <>
      <div className="d-flex align-center">
        <Image
          className="mr-2"
          src={current.logo || ''}
          alt={current.label}
          width="24"
          height="24"
        />
        {current.label}
      </div>
      <Form form={form} layout="vertical" className="py-3 px-4">
        <current.component mode={FORM_MODE.EDIT} />

        {updateError && (
          <Alert
            message="更新知识库连接失败"
            description={updateError.message}
            type="error"
            showIcon
            className="my-6"
          />
        )}

        <div className="py-2 text-right">
          <Button className="mr-2" style={{ width: 80 }} onClick={reset}>
            取消
          </Button>
          <Button
            type="primary"
            style={{ width: 80 }}
            onClick={submit}
            loading={updating}
          >
            保存
          </Button>
        </div>
      </Form>
    </>
  );
};

export default function ConnectionSettings(props: Props) {
  const { sampleDataset } = props;
  const Component = sampleDataset ? SampleDatasetPanel : ConnectionPanel;
  return (
    <div className="py-3 px-4">
      <Component {...props} />
    </div>
  );
}
