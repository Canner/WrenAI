import { useContext } from 'react';
import { Typography } from 'antd';
import FieldTable from '@/components/table/FieldTable';
import CalculatedFieldTable from '@/components/table/CalculatedFieldTable';
import RelationTable from '@/components/table/RelationTable';
import { makeEditableBaseTable } from '@/components/table/EditableBaseTable';
import { COLUMN } from '@/components/table/BaseTable';
import { EditableContext } from '@/components/EditableWrapper';
import GenerateBasicMetadata from './GenerateBasicMetadata';

export interface Props {
  formNamespace: string;
  displayName: string;
  fields: any[];
  calculatedFields?: any[];
  relations: any[];
  properties: Record<string, any>;
}

export default function GenerateModelMetadata(props: Props) {
  const {
    formNamespace,
    displayName,
    fields = [],
    calculatedFields = [],
    relations = [],
    properties,
  } = props || {};

  const FieldEditableTable = makeEditableBaseTable(FieldTable);
  const CalculatedFieldEditableTable =
    makeEditableBaseTable(CalculatedFieldTable);
  const RelationEditableTable = makeEditableBaseTable(RelationTable);

  const form = useContext(EditableContext);

  const onChange = (value) => {
    form.setFieldsValue({
      generatedMetadata: {
        ...(form.getFieldValue(formNamespace) || {}),
        ...value,
      },
    });
  };

  return (
    <>
      <GenerateBasicMetadata
        dataSource={{ displayName, properties }}
        onChange={onChange}
      />

      <div className="mb-6">
        <Typography.Text className="d-block gray-7 mb-2">
          Fields ({fields.length})
        </Typography.Text>
        <FieldEditableTable
          dataSource={fields}
          columns={[
            COLUMN.REFERENCE_NAME,
            COLUMN.DISPLAY_NAME,
            COLUMN.DESCRIPTION,
          ]}
          onChange={(value) => onChange({ fields: value })}
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
              COLUMN.REFERENCE_NAME,
              COLUMN.DISPLAY_NAME,
              COLUMN.DESCRIPTION,
            ]}
            onChange={(value) => onChange({ calculatedFields: value })}
          />
        </div>
      )}

      <div className="mb-6">
        <Typography.Text className="d-block gray-7 mb-2">
          Relationships ({relations.length})
        </Typography.Text>
        <RelationEditableTable
          dataSource={relations}
          columns={[
            COLUMN.REFERENCE_NAME,
            COLUMN.DISPLAY_NAME,
            COLUMN.DESCRIPTION,
          ]}
          onChange={(value) => onChange({ relations: value })}
        />
      </div>
    </>
  );
}
