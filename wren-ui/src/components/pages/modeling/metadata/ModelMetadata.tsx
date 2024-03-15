import { Typography } from 'antd';
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
    referenceName,
    fields = [],
    calculatedFields = [],
    relations = [],
  } = props || {};

  const CalculatedFieldMetadataTable =
    makeMetadataBaseTable(CalculatedFieldTable)(UpdateMetadataModal);

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
      <div className="mb-6">
        <Typography.Text className="d-block gray-7 mb-2">Name</Typography.Text>
        <div>{referenceName || '-'}</div>
      </div>

      <div className="mb-6">
        <Typography.Text className="d-block gray-7 mb-2">
          Fields ({fields.length})
        </Typography.Text>
        <FieldTable dataSource={fields} />
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
        <RelationTable dataSource={relations} />
      </div>
    </>
  );
}
