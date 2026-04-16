import Image from 'next/image';
import { useEffect, useState } from 'react';
import { Button, Form, Modal, message, Alert } from 'antd';
import { makeIterable } from '@/utils/iteration';
import { DATA_SOURCES, FORM_MODE, Path } from '@/utils/enum';
import { getDataSource, getTemplates } from '@/components/pages/setup/utils';
import { FlexLoading } from '@/components/PageLoading';
import ButtonItem from '@/components/pages/setup/ButtonItem';
import {
  transformFormToProperties,
  transformPropertiesToForm,
} from '@/hooks/useSetupConnectionDataSource';
import {
  startSampleDataset,
  updateDataSourceSettings,
} from '@/utils/settingsRest';
import { DataSourceName, SampleDatasetName } from '@/types/api';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { clearRuntimePagePrefetchCache } from '@/utils/runtimePagePrefetch';

interface Props {
  type: DataSourceName;
  properties: Record<string, any>;
  sampleDataset: SampleDatasetName;
  refetchSettings: () => Promise<unknown>;
  closeModal: () => void;
}

const SampleDatasetIterator = makeIterable(ButtonItem);

const SampleDatasetPanel = (props: Props) => {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const { sampleDataset, closeModal } = props;
  const templates = getTemplates();

  const onSelect = (name: SampleDatasetName) => {
    const isCurrentTemplate = sampleDataset === name;
    if (!isCurrentTemplate) {
      const template = templates.find((item) => item.value === name);
      Modal.confirm({
        title: `Are you sure you want to change to "${template?.label || name}" dataset?`,
        okButtonProps: { danger: true },
        okText: 'Change',
        onOk: async () => {
          try {
            await startSampleDataset(runtimeScopeNavigation.selector, name);
            clearRuntimePagePrefetchCache();
            runtimeScopeNavigation.pushWorkspace(Path.Home);
            closeModal();
          } catch (error) {
            message.error(
              error instanceof Error
                ? error.message
                : '切换样例数据失败，请稍后重试。',
            );
            throw error;
          }
        },
      });
    }
  };

  return (
    <>
      <div className="mb-2">Change sample dataset</div>
      <div className="d-grid grid-columns-3 g-4">
        <SampleDatasetIterator
          data={templates}
          selectedTemplate={sampleDataset}
          onSelect={onSelect}
        />
      </div>
      <div className="gray-6 mt-1">
        Please be aware that choosing another sample dataset will delete all
        thread records in the Home page.
      </div>
    </>
  );
};

const DataSourcePanel = (props: Props) => {
  const { type, properties, refetchSettings } = props;
  const managedFederatedRuntime = Boolean(
    properties?.managedFederatedRuntime && type === DataSourceName.TRINO,
  );

  const current = getDataSource(type as unknown as DATA_SOURCES);
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const [form] = Form.useForm();
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<Error | null>(null);

  useEffect(() => {
    if (properties) {
      form.setFieldsValue(transformPropertiesToForm(properties, type));
    }
  }, [form, properties, type]);

  const reset = () => {
    form.setFieldsValue(transformPropertiesToForm(properties, type));
  };

  const submit = () => {
    form
      .validateFields()
      .then(async (values) => {
        try {
          setUpdating(true);
          setUpdateError(null);
          await updateDataSourceSettings(runtimeScopeNavigation.selector, {
            type,
            properties: transformFormToProperties(values, type),
          });
          await refetchSettings();
          message.success('Successfully update data source.');
        } catch (error) {
          const normalizedError =
            error instanceof Error
              ? error
              : new Error('更新数据源失败，请稍后重试。');
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
          message="联邦运行时由系统自动维护"
          description={
            properties?.readonlyReason ||
            '当前数据源来自多 connector 聚合运行时，请前往知识库 → 连接器维护。'
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
            message="更新数据源失败"
            description={updateError.message}
            type="error"
            showIcon
            className="my-6"
          />
        )}

        <div className="py-2 text-right">
          <Button className="mr-2" style={{ width: 80 }} onClick={reset}>
            Cancel
          </Button>
          <Button
            type="primary"
            style={{ width: 80 }}
            onClick={submit}
            loading={updating}
          >
            Save
          </Button>
        </div>
      </Form>
    </>
  );
};

export default function DataSourceSettings(props: Props) {
  const { sampleDataset } = props;
  const Component = sampleDataset ? SampleDatasetPanel : DataSourcePanel;
  return (
    <div className="py-3 px-4">
      <Component {...props} />
    </div>
  );
}
