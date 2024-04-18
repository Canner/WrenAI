import Image from 'next/image';
import { Button, Form, Modal } from 'antd';
import { makeIterable } from '@/utils/iteration';
import { DATA_SOURCES, FORM_MODE } from '@/utils/enum';
import { getDataSource, getTemplates } from '@/components/pages/setup/utils';
import ButtonItem from '@/components/pages/setup/ButtonItem';
import { useStartSampleDatasetMutation } from '@/apollo/client/graphql/dataSource.generated';
import { SampleDatasetName } from '@/apollo/client/graphql/__types__';

interface Props {
  type: DATA_SOURCES;
  properties: Record<string, any>;
  sampleDataset: SampleDatasetName;
}

const SampleDatasetIterator = makeIterable(ButtonItem);

const SampleDatasetPanel = (props: Props) => {
  const { sampleDataset } = props;
  const templates = getTemplates();
  const [startSampleDataset] = useStartSampleDatasetMutation({
    refetchQueries: 'active',
  });

  const onSelect = (name: SampleDatasetName) => {
    const template = templates.find((item) => item.value === name);
    Modal.confirm({
      title: `Are you sure you want to change to "${template.label}" dataset?`,
      okButtonProps: { danger: true },
      okText: 'Change',
      onOk: async () => {
        await startSampleDataset({ variables: { data: { name } } });
      },
    });
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
  const { type, properties } = props;

  const current = getDataSource(type);
  const [form] = Form.useForm();

  const reset = () => {
    form.setFieldsValue({ ...properties });
  };

  const submit = () => {
    form.validateFields().then((values) => {
      console.log(values);
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
          <Button type="primary" style={{ width: 80 }} onClick={submit}>
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
