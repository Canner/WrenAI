import { Typography } from 'antd';
import MeasureFieldTable from '@/components/table/MeasureFieldTable';
import DimensionFieldTable from '@/components/table/DimensionFieldTable';
import WindowFieldTable from '@/components/table/WindowFieldTable';
import { makeMetadataBaseTable } from '@/components/table/MetadataBaseTable';
import UpdateMetadataModal from '@/components/modals/UpdateMetadataModal';

export interface Props {
  measures: any[];
  dimensions?: any[];
  windows?: any[];
  properties: Record<string, any>;
}

export default function MetricMetadata(props: Props) {
  const { measures = [], dimensions, windows, properties } = props || {};

  const MeasureFieldMetadataTable =
    makeMetadataBaseTable(MeasureFieldTable)(UpdateMetadataModal);
  const DimensionFieldMetadataTable =
    makeMetadataBaseTable(DimensionFieldTable)(UpdateMetadataModal);
  const WindowFieldMetadataTable =
    makeMetadataBaseTable(WindowFieldTable)(UpdateMetadataModal);

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
      <div className="mb-6">
        <Typography.Text className="d-block gray-7 mb-2">
          Description
        </Typography.Text>
        <div>{properties?.description || '-'}</div>
      </div>

      <div className="mb-6">
        <Typography.Text className="d-block gray-7 mb-2">
          Measures ({measures.length})
        </Typography.Text>
        <MeasureFieldMetadataTable
          dataSource={measures}
          onEditValue={editMetadataValue}
          onSubmitRemote={submitMetadata}
        />
      </div>

      {!!dimensions && (
        <div className="mb-6">
          <Typography.Text className="d-block gray-7 mb-2">
            Dimensions ({dimensions.length})
          </Typography.Text>
          <DimensionFieldMetadataTable
            dataSource={dimensions}
            onEditValue={editMetadataValue}
            onSubmitRemote={submitMetadata}
          />
        </div>
      )}

      {!!windows && (
        <div className="mb-6">
          <Typography.Text className="d-block gray-7 mb-2">
            Windows ({windows.length})
          </Typography.Text>
          <WindowFieldMetadataTable
            dataSource={windows}
            onEditValue={editMetadataValue}
            onSubmitRemote={submitMetadata}
          />
        </div>
      )}
    </>
  );
}
