import { useContext } from 'react';
import { Typography } from 'antd';
import { NODE_TYPE } from '@/utils/enum';
import FieldTable from '@/components/table/FieldTable';
import CalculatedFieldTable from '@/components/table/CalculatedFieldTable';
import RelationTable from '@/components/table/RelationTable';
import { makeEditableBaseTable } from '@/components/table/EditableBaseTable';
import { COLUMN } from '@/components/table/BaseTable';
import { EditableContext } from '@/components/EditableWrapper';
import EditBasicMetadata from './EditBasicMetadata';
import NestedFieldTable from '@/components/table/NestedFieldTable';

export interface Props {
  formNamespace: string;
  displayName: string;
  referenceName: string;
  fields: any[];
  calculatedFields?: any[];
  relationFields: any[];
  description: string;
  properties: Record<string, any>;
  nodeType: NODE_TYPE;
  modelId: number;
}

const FIELDS_NAME = {
  FIELDS: 'columns',
  NESTED_FIELDS: 'nestedColumns',
  CALCULATED_FIELDS: 'calculatedFields',
  RELATIONSHIPS: 'relationships',
};

const FieldEditableTable = makeEditableBaseTable(FieldTable);
const NestedFieldEditableTable = makeEditableBaseTable(NestedFieldTable as any);
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
    nodeType,
    modelId,
  } = props || {};

  const form = useContext(EditableContext);

  const onChange = (value) => {
    form.setFieldsValue({
      [formNamespace]: {
        ...(form.getFieldValue(formNamespace) || {}),
        ...value,
        modelId,
      },
    });
  };

  const handleMetadataChange = (fieldsName: string) => (value: any[]) => {
    // bind changeable metadata values
    onChange({
      [fieldsName]: value.map((item) => ({
        id: item.relationId || item.columnId || item.nestedColumnId,
        description: item.description,
        // Only models & fields, nested fields have alias
        ...([FIELDS_NAME.FIELDS, FIELDS_NAME.NESTED_FIELDS].includes(fieldsName)
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
        nodeType={nodeType}
      />

      <div className="mb-6">
        <Typography.Text className="d-block gray-7 mb-2">
          Columns ({fields.length})
        </Typography.Text>
        <FieldEditableTable
          dataSource={fields}
          columns={[
            COLUMN.NAME,
            COLUMN.ALIAS,
            { ...COLUMN.TYPE, width: 150 },
            { ...COLUMN.DESCRIPTION, width: 280 },
          ]}
          onChange={handleMetadataChange(FIELDS_NAME.FIELDS)}
          showExpandable
          expandable={{
            expandedRowRender: (record) => (
              <div className="px-3 py-2">
                <NestedFieldEditableTable
                  dataSource={record.nestedFields as any}
                  columns={[
                    COLUMN.NAME,
                    COLUMN.ALIAS,
                    COLUMN.TYPE,
                    COLUMN.DESCRIPTION,
                  ]}
                  onChange={handleMetadataChange(FIELDS_NAME.NESTED_FIELDS)}
                />
              </div>
            ),
            rowExpandable: (record) => !!record.nestedFields,
          }}
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
              { ...COLUMN.NAME, dataIndex: 'displayName', width: 160 },
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
              { ...COLUMN.NAME, dataIndex: 'displayName' },
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
