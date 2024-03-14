import { useMemo } from 'react';
import Link from 'next/link';
import { Button, Col, Form, Row, TableColumnsType, Typography } from 'antd';
import { getColumnTypeIcon } from '@/utils/columnType';
import { ERROR_TEXTS } from '@/utils/error';
import { makeIterable, IterableComponent } from '@/utils/iteration';
import ModelRelationSelectionTable, {
  SourceTable,
  SourceTableColumn,
} from '@/components/table/ModelRelationSelectionTable';

const { Title, Text } = Typography;

export interface SelectedSourceTables {
  [tableName: string]: SourceTableColumn[];
}

interface Props {
  onNext: (data: { models: SelectedSourceTables }) => void;
  onBack: () => void;
  selectedModels: string[];
  tables: SourceTable[];
}

const columns: TableColumnsType<SourceTableColumn> = [
  {
    title: 'Field name',
    dataIndex: 'name',
    width: '65%',
  },
  {
    title: 'Type',
    dataIndex: 'type',
    width: '35%',
    render: (type) => (
      <div className="d-flex align-center">
        {getColumnTypeIcon({ type }, { className: 'mr-1' })}
        {type}
      </div>
    ),
  },
];

const SelectModelTemplate: IterableComponent = ({ index, name, fields }) => (
  <Form.Item
    className="mt-6"
    key={name}
    name={name}
    rules={[
      {
        required: true,
        message: ERROR_TEXTS.SETUP_MODEL.FIELDS.REQUIRED,
      },
    ]}
  >
    <ModelRelationSelectionTable
      columns={columns}
      enableRowSelection
      dataSource={fields}
      tableTitle={name}
      rowKey={(record: SourceTableColumn) => `${name}-${record.name}-${index}`}
    />
  </Form.Item>
);

export default function CreateModels(props: Props) {
  const { onBack, onNext, selectedModels, tables } = props;

  const [form] = Form.useForm();

  const selectModelFields = useMemo(() => {
    return selectedModels.map((modelName) => {
      const table = tables.find((table) => table.displayName === modelName);
      return {
        name: modelName,
        fields: table.columns,
      };
    });
  }, [selectedModels, tables]);

  const SelectModelIterator = makeIterable(SelectModelTemplate);

  const submit = () => {
    form
      .validateFields()
      .then((values) => {
        onNext && onNext({ models: { ...values } });
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

      <Form form={form} layout="vertical" className="my-6">
        <SelectModelIterator data={selectModelFields} />
      </Form>

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
