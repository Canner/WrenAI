import { useRouter } from 'next/router';
import Image from 'next/image';
import { useEffect, useMemo } from 'react';
import { Button, Form, Modal, message, Alert } from 'antd';
import { makeIterable } from '@/utils/iteration';
import { DATA_SOURCES, FORM_MODE, Path } from '@/utils/enum';
import { getDataSource, getTemplates } from '@/components/pages/setup/utils';
import { FlexLoading } from '@/components/PageLoading';
import ButtonItem from '@/components/pages/setup/ButtonItem';
import {
  transformFormToProperties,
  transformPropertiesToForm,
} from '@/hooks/useSetupConnection';
import { parseGraphQLError } from '@/utils/errorHandler';
import {
  useStartSampleDatasetMutation,
  useUpdateDataSourceMutation,
} from '@/apollo/client/graphql/dataSource.generated';
import {
  DataSourceName,
  SampleDatasetName,
} from '@/apollo/client/graphql/__types__';

interface Props {
  type: DataSourceName;
  properties: Record<string, any>;
  sampleDataset: SampleDatasetName;
  refetchSettings: () => void;
  closeModal: () => void;
}

const SampleDatasetIterator = makeIterable(ButtonItem);

const SampleDatasetPanel = (props: Props) => {
  const router = useRouter();
  const { sampleDataset, closeModal } = props;
  const templates = getTemplates();
  const [startSampleDataset] = useStartSampleDatasetMutation({
    onError: (error) => console.error(error),
    onCompleted: () => {
      router.push(Path.Home);
      closeModal();
    },
    refetchQueries: 'active',
  });

  const onSelect = (name: SampleDatasetName) => {
    const isCurrentTemplate = sampleDataset === name;
    if (!isCurrentTemplate) {
      const template = templates.find((item) => item.value === name);
      Modal.confirm({
        title: `Are you sure you want to change to "${template.label}" dataset?`,
        okButtonProps: { danger: true },
        okText: 'Change',
        onOk: async () => {
          await startSampleDataset({ variables: { data: { name } } });
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

  const current = getDataSource(type as unknown as DATA_SOURCES);
  const [form] = Form.useForm();

  const [updateDataSource, { loading, error }] = useUpdateDataSourceMutation({
    onError: (error) => console.error(error),
    onCompleted: async () => {
      refetchSettings();
      message.success('Successfully update data source.');
    },
  });

  const updateError = useMemo(() => parseGraphQLError(error), [error]);

  useEffect(() => properties && reset(), [properties]);

  const reset = () => {
    form.setFieldsValue(transformPropertiesToForm(properties, type));
  };

  const submit = () => {
    form
      .validateFields()
      .then((values) => {
        updateDataSource({
          variables: {
            data: { properties: transformFormToProperties(values, type) },
          },
        });
      })
      .catch((error) => {
        console.error(error);
      });
  };

  if (!type) return <FlexLoading align="center" height={150} />;

  return (
    <>
      <div className="d-flex align-center">
        <Image
          className="mr-2"
          src={current.logo}
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
            message={updateError.shortMessage}
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
            loading={loading}
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
