import Link from 'next/link';
import { Button, Col, Form, Row, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ERROR_TEXTS } from '@/utils/error';
import MultiSelectBox from '@/components/table/MultiSelectBox';
import { SourceTable } from '@/components/table/ModelRelationSelectionTable';

const { Title, Text } = Typography;

interface Props {
  tables: SourceTable[];
  onNext: (data: { selectedModels: string[] }) => void;
  onBack: () => void;
}

const columns: ColumnsType<SourceTable> = [
  {
    title: 'Table name',
    dataIndex: 'displayName',
  },
];

export default function SelectModels(props: Props) {
  const { tables, onBack, onNext } = props;
  const [form] = Form.useForm();

  const items = tables.map((item) => ({
    ...item,
    value: item.displayName,
  }));

  const submit = () => {
    form
      .validateFields()
      .then((values) => {
        onNext && onNext({ selectedModels: values.models });
      })
      .catch((error) => {
        console.error(error);
      });
  };

  return (
    <div>
      <Title level={1} className="mb-3">
        Create data model from tables
      </Title>
      <Text>
        Data models are created directly from your data source tables. It act as
        a “view” of your underlying table to transform and extend on the
        original data.{` `}
        <Link href="" target="_blank" rel="noopener noreferrer">
          Learn more
        </Link>
      </Text>
      <div className="my-6">
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item
            name="models"
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
          <Button onClick={onBack} size="large" block>
            Back
          </Button>
        </Col>
        <Col className="text-right" span={12}>
          <Button type="primary" size="large" block onClick={submit}>
            Next
          </Button>
        </Col>
      </Row>
    </div>
  );
}
