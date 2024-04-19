import Image from 'next/image';
import { useEffect } from 'react';
import { Button, Form, Modal, message } from 'antd';
import { makeIterable } from '@/utils/iteration';
import { DATA_SOURCES, FORM_MODE } from '@/utils/enum';
import { getDataSource, getTemplates } from '@/components/pages/setup/utils';
import ButtonItem from '@/components/pages/setup/ButtonItem';
import {
  useStartSampleDatasetMutation,
  useUpdateDataSourceMutation,
} from '@/apollo/client/graphql/dataSource.generated';
import { SampleDatasetName } from '@/apollo/client/graphql/__types__';

interface Props {
  type: DATA_SOURCES;
  properties: Record<string, any>;
  sampleDataset: SampleDatasetName;
  refetchSettings: () => void;
}

const SampleDatasetIterator = makeIterable(ButtonItem);

const SampleDatasetPanel = (props: Props) => {
  const { sampleDataset } = props;
  const templates = getTemplates();
  const [startSampleDataset] = useStartSampleDatasetMutation({
    onError: (error) => console.error(error),
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

  const current = getDataSource(type);
  const [form] = Form.useForm();

  const [updateDataSource, { loading }] = useUpdateDataSourceMutation({
    onError: (error) => console.error(error),
    onCompleted: async () => {
      refetchSettings();
      message.success('Update successfully.');
    },
  });

  useEffect(() => reset(), [properties]);

  const reset = () => {
    form.setFieldsValue({ ...properties, credentials: undefined });
  };

  const submit = () => {
    form
      .validateFields()
      .then((values) => {
        updateDataSource({ variables: { data: { properties: values } } });
      })
      .catch((error) => {
        console.error(error);
      });
  };

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
