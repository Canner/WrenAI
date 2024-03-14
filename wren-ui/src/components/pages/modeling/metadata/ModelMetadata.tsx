import { Typography, Row, Col } from 'antd';
import FieldTable from '@/components/table/FieldTable';
import CalculatedFieldTable from '@/components/table/CalculatedFieldTable';
import RelationTable from '@/components/table/RelationTable';
import { makeMetadataBaseTable } from '@/components/table/MetadataBaseTable';
import UpdateMetadataModal from '@/components/modals/UpdateMetadataModal';

export interface Props {
  displayName: string;
  referenceName: string;
  sourceTableName: string;
  fields: any[];
  calculatedFields: any[];
  relations: any[];
  properties: Record<string, any>;
}

export default function ModelMetadata(props: Props) {
  const {
    displayName,
    sourceTableName,
    referenceName,
    fields = [],
    calculatedFields = [],
    relations = [],
    properties,
  } = props || {};

  const FieldMetadataTable =
    makeMetadataBaseTable(FieldTable)(UpdateMetadataModal);
  const CalculatedFieldMetadataTable =
    makeMetadataBaseTable(CalculatedFieldTable)(UpdateMetadataModal);
  const RelationMetadataTable =
    makeMetadataBaseTable(RelationTable)(UpdateMetadataModal);

  // To convert edit value for update metadata modal
  const editMetadataValue = (value) => {
    return {
      displayName: value.displayName || value.name,
      description: value.properties?.description,
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
        <Col span={12}>
          <div className="mb-6">
            <Typography.Text className="d-block gray-7 mb-2">
              Source table name
            </Typography.Text>
            <div>{sourceTableName || '-'}</div>
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

      {!!calculatedFields.length && (
        <div className="mb-6">
          <Typography.Text className="d-block gray-7 mb-2">
            Calculated fields ({calculatedFields.length})
          </Typography.Text>
          <CalculatedFieldMetadataTable
            dataSource={calculatedFields}
            onEditValue={editMetadataValue}
            onSubmitRemote={submitMetadata}
          />
        </div>
      )}

      <div className="mb-6">
        <Typography.Text className="d-block gray-7 mb-2">
          Relations ({relations.length})
        </Typography.Text>
        <RelationMetadataTable
          dataSource={relations}
          onEditValue={editMetadataValue}
          onSubmitRemote={submitMetadata}
        />
      </div>
    </>
  );
}
