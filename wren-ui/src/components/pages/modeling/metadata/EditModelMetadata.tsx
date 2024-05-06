import { useContext } from 'react';
import { Typography } from 'antd';
import FieldTable from '@/components/table/FieldTable';
import CalculatedFieldTable from '@/components/table/CalculatedFieldTable';
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

const FIELDS_NAME = {
  FIELDS: 'columns',
  CALCULATED_FIELDS: 'calculatedFields',
  RELATIONSHIPS: 'relationships',
};

const FieldEditableTable = makeEditableBaseTable(FieldTable);
const CalculatedFieldEditableTable =
  makeEditableBaseTable(CalculatedFieldTable);
const RelationshipEditableTable = makeEditableBaseTable(RelationTable);

export default function EditModelMetadata(props: Props) {
  const {
    formNamespace,
    displayName,
    referenceName,
    fields = [],
    calculatedFields = [],
    relationFields = [],
    description,
  } = props || {};

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
        id: item.relationId || item.columnId,
        description: item.description,
        // Only models & fields have alias
        ...(fieldsName === FIELDS_NAME.FIELDS
          ? { displayName: item.displayName }
          : {}),
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
            { ...COLUMN.TYPE, width: 150 },
            { ...COLUMN.DESCRIPTION, width: 280 },
          ]}
          onChange={handleMetadataChange(FIELDS_NAME.FIELDS)}
        />
      </div>

      {!!calculatedFields.length && (
        <div className="mb-6">
          <Typography.Text className="d-block gray-7 mb-2">
            Calculated fields ({calculatedFields.length})
          </Typography.Text>
          <CalculatedFieldEditableTable
            dataSource={calculatedFields}
            columns={[
              { ...COLUMN.REFERENCE_NAME, width: 160 },
              COLUMN.EXPRESSION,
              { ...COLUMN.DESCRIPTION, width: 280 },
            ]}
            onChange={handleMetadataChange(FIELDS_NAME.CALCULATED_FIELDS)}
          />
        </div>
      )}

      {!!relationFields.length && (
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
              { ...COLUMN.RELATION, width: 130 },
              { ...COLUMN.DESCRIPTION, width: 200 },
            ]}
            onChange={handleMetadataChange(FIELDS_NAME.RELATIONSHIPS)}
          />
        </div>
      )}
    </>
  );
}
