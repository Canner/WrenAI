import { Col, Row, Typography } from 'antd';
import FieldTable from '@/components/table/FieldTable';
import CalculatedFieldTable from '@/components/table/CalculatedFieldTable';
import RelationTable from '@/components/table/RelationTable';

export interface Props {
  displayName: string;
  referenceName: string;
  sourceTableName: string;
  fields: any[];
  calculatedFields: any[];
  relationFields: any[];
  description: string;
  properties: Record<string, any>;
}

export default function ModelMetadata(props: Props) {
  const {
    displayName,
    referenceName,
    fields = [],
    calculatedFields = [],
    relationFields = [],
    description,
  } = props || {};

  return (
    <>
      <Row className="mb-6">
        <Col span={12}>
          <Typography.Text className="d-block gray-7 mb-2">
            Name
          </Typography.Text>
          <div>{referenceName || '-'}</div>
        </Col>
        <Col span={12}>
          <Typography.Text className="d-block gray-7 mb-2">
            Alias
          </Typography.Text>
          <div>{displayName || '-'}</div>
        </Col>
      </Row>
      <div className="mb-6">
        <Typography.Text className="d-block gray-7 mb-2">
          Description
        </Typography.Text>
        <div>{description || '-'}</div>
      </div>

      <div className="mb-6">
        <Typography.Text className="d-block gray-7 mb-2">
          Columns ({fields.length})
        </Typography.Text>
        <FieldTable dataSource={fields} showExpandable />
      </div>

      <div className="mb-6">
        <Typography.Text className="d-block gray-7 mb-2">
          Calculated fields ({calculatedFields.length})
        </Typography.Text>
        <CalculatedFieldTable dataSource={calculatedFields} showExpandable />
      </div>

      <div className="mb-6">
        <Typography.Text className="d-block gray-7 mb-2">
          Relationships ({relationFields.length})
        </Typography.Text>
        <RelationTable dataSource={relationFields} showExpandable />
      </div>
    </>
  );
}
