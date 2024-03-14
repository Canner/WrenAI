import { useContext } from 'react';
import { Typography } from 'antd';
import FieldTable from '@/components/table/FieldTable';
import { makeEditableBaseTable } from '@/components/table/EditableBaseTable';
import { COLUMN } from '@/components/table/BaseTable';
import { EditableContext } from '@/components/EditableWrapper';
import GenerateBasicMetadata from './GenerateBasicMetadata';

export interface Props {
  formNamespace: string;
  displayName: string;
  fields: any[];
  properties: Record<string, any>;
}

export default function GenerateModelMetadata(props: Props) {
  const { formNamespace, displayName, fields = [], properties } = props || {};

  const FieldEditableTable = makeEditableBaseTable(FieldTable);

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
    </>
  );
}
