import { Typography, Row, Col } from 'antd';
import FieldTable from '@/components/table/FieldTable';
import { makeMetadataBaseTable } from '@/components/table/MetadataBaseTable';
import UpdateMetadataModal from '@/components/modals/UpdateMetadataModal';

export interface Props {
  displayName: string;
  referenceName: string;
  fields: any[];
  properties: Record<string, any>;
}

export default function ViewMetadata(props: Props) {
  const { displayName, referenceName, fields = [], properties } = props || {};

  const FieldMetadataTable =
    makeMetadataBaseTable(FieldTable)(UpdateMetadataModal);

  // To convert edit value for update metadata modal
  const editMetadataValue = (value) => {
    return {
      displayName: value.displayName || value.name,
      description: value.description,
    };
  };

  const submitMetadata = (values) => {
    // TODO: waiting for API
    console.log(values);
  };

  return (
    <>
      <Row>
        <Col span={12}>
          <div className="mb-6">
            <Typography.Text className="d-block gray-7 mb-2">
              Display name
            </Typography.Text>
            <div>{displayName || '-'}</div>
          </div>
        </Col>
        <Col span={12}>
          <div className="mb-6">
            <Typography.Text className="d-block gray-7 mb-2">
              Reference name
            </Typography.Text>
            <div>{referenceName || '-'}</div>
          </div>
        </Col>
        <Col span={24}>
          <div className="mb-6">
            <Typography.Text className="d-block gray-7 mb-2">
              Description
            </Typography.Text>
            <div>{properties?.description || '-'}</div>
          </div>
        </Col>
      </Row>

      <div className="mb-6">
        <Typography.Text className="d-block gray-7 mb-2">
          Fields ({fields.length})
        </Typography.Text>
        <FieldMetadataTable
          dataSource={fields}
          onEditValue={editMetadataValue}
          onSubmitRemote={submitMetadata}
        />
      </div>
    </>
  );
}
