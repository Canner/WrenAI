import { useContext } from 'react';
import { Typography } from 'antd';
import FieldTable from '@/components/table/FieldTable';
import RelationTable from '@/components/table/RelationTable';
import { makeEditableBaseTable } from '@/components/table/EditableBaseTable';
import { COLUMN } from '@/components/table/BaseTable';
import { EditableContext } from '@/components/EditableWrapper';
import EditBasicMetadata from './EditBasicMetadata';

export interface Props {
  formNamespace: string;
  displayName: string;
  referenceName: string;
  fields: any[];
  calculatedFields?: any[];
  relationFields: any[];
  description: string;
  properties: Record<string, any>;
}

export default function EditModelMetadata(props: Props) {
  const {
    formNamespace,
    displayName,
    referenceName,
    fields = [],
    relationFields = [],
    description,
  } = props || {};

  const FieldEditableTable = makeEditableBaseTable(FieldTable);
  const RelationshipEditableTable = makeEditableBaseTable(RelationTable);

  const form = useContext(EditableContext);

  const onChange = (value) => {
    form.setFieldsValue({
      [formNamespace]: {
        ...(form.getFieldValue(formNamespace) || {}),
        ...value,
      },
    });
  };

  const handleMetadataChange = (fieldsName: string) => (value: any[]) => {
    // bind changeable metadata values
    onChange({
      [fieldsName]: value.map((item) => ({
        displayName: item.displayName,
        description: item.description,
      })),
    });
  };

  return (
    <>
      <EditBasicMetadata
        dataSource={{ displayName, referenceName, description }}
        onChange={onChange}
      />

      <div className="mb-6">
        <Typography.Text className="d-block gray-7 mb-2">
          Columns ({fields.length})
        </Typography.Text>
        <FieldEditableTable
          dataSource={fields}
          columns={[
            COLUMN.REFERENCE_NAME,
            COLUMN.ALIAS,
            COLUMN.TYPE,
            COLUMN.DESCRIPTION,
          ]}
          onChange={handleMetadataChange('fields')}
        />
      </div>

      <div className="mb-6">
        <Typography.Text className="d-block gray-7 mb-2">
          Relationships ({relationFields.length})
        </Typography.Text>
        <RelationshipEditableTable
          dataSource={relationFields}
          columns={[
            COLUMN.REFERENCE_NAME,
            COLUMN.RELATION_FROM,
            COLUMN.RELATION_TO,
            COLUMN.RELATION,
            COLUMN.DESCRIPTION,
          ]}
          onChange={handleMetadataChange('relationFields')}
        />
      </div>
    </>
  );
}
