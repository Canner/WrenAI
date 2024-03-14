import Link from 'next/link';
import { Button, Col, Form, Row, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ERROR_TEXTS } from '@/utils/error';
import MultiSelectBox from '@/components/table/MultiSelectBox';

const { Title, Text } = Typography;

export interface SourceTable {
  name: string;
}

interface Props {
  tables: SourceTable[];
  onNext: (data: { selectedTables: string[] }) => void;
  onBack: () => void;
}

const columns: ColumnsType<SourceTable> = [
  {
    title: 'Table name',
    dataIndex: 'name',
  },
];

export default function SelectModels(props: Props) {
  const { tables, onBack, onNext } = props;
  const [form] = Form.useForm();

  const items = tables.map((item) => ({
    ...item,
    value: item.name,
  }));

  const submit = () => {
    form
      .validateFields()
      .then((values) => {
        onNext && onNext({ selectedTables: values.tables });
      })
      .catch((error) => {
        console.error(error);
      });
  };

  return (
    <div>
      <Title level={1} className="mb-3">
        Select tables to create data models
      </Title>
      <Text>
        We will create data models from selected tables. It will help AI to
        better know your data.
        <br />
        <Link href="" target="_blank" rel="noopener noreferrer">
          Learn more
        </Link>{' '}
        about data models.
      </Text>
      <div className="my-6">
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item
            name="tables"
            rules={[
              {
                required: true,
                message: ERROR_TEXTS.SETUP_MODEL.TABLE.REQUIRED,
              },
            ]}
          >
            <MultiSelectBox columns={columns} items={items} />
          </Form.Item>
        </Form>
      </div>
      <Row gutter={16} className="pt-6">
        <Col span={12}>
          <Button onClick={onBack} size="large" className="adm-onboarding-btn">
            Back
          </Button>
        </Col>
        <Col className="text-right" span={12}>
          <Button
            type="primary"
            size="large"
            onClick={submit}
            className="adm-onboarding-btn"
          >
            Next
          </Button>
        </Col>
      </Row>
    </div>
  );
}
