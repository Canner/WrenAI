import { Button, Form } from 'antd';
import Image from 'next/image';
import { DATA_SOURCES, FORM_MODE } from '@/utils/enum';
import { getDataSource } from '@/components/pages/setup/utils';

export default function DataSourceSettings() {
  const type = DATA_SOURCES.BIG_QUERY;
  const current = getDataSource(type);
  const [form] = Form.useForm();

  const reset = () => {
    // TODO: reset form to original values
  };

  const submit = () => {
    form.validateFields().then((values) => {
      console.log(values);
    });
  };

  return (
    <>
      <div className="d-flex align-center py-3 px-4">
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
}
