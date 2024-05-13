import { useContext } from 'react';
import { Typography } from 'antd';
import { NODE_TYPE } from '@/utils/enum';
import FieldTable from '@/components/table/FieldTable';
import { makeEditableBaseTable } from '@/components/table/EditableBaseTable';
import { createViewNameValidator } from '@/utils/validator';
import { COLUMN } from '@/components/table/BaseTable';
import { EditableContext } from '@/components/EditableWrapper';
import EditBasicMetadata from './EditBasicMetadata';
import { useValidateViewMutation } from '@/apollo/client/graphql/view.generated';

export interface Props {
  formNamespace: string;
  displayName: string;
  fields: any[];
  description: string;
  properties: Record<string, any>;
  nodeType: NODE_TYPE;
  viewId: number;
}

const FIELDS_NAME = {
  FIELDS: 'columns',
};

const FieldEditableTable = makeEditableBaseTable(FieldTable);

export default function EditViewMetadata(props: Props) {
  const {
    formNamespace,
    displayName,
    fields = [],
    description,
    nodeType,
    viewId,
  } = props || {};

  const form = useContext(EditableContext);

  const [validateViewMutation] = useValidateViewMutation({
    fetchPolicy: 'no-cache',
  });

  const onChange = (value) => {
    form.setFieldsValue({
      [formNamespace]: {
        ...(form.getFieldValue(formNamespace) || {}),
        ...value,
        viewId,
      },
    });
  };

  const handleMetadataChange = (fieldsName: string) => (value: any[]) => {
    // bind changeable metadata values
    // The view's columns don't have their own column IDs, so we use the referenceName
    onChange({
      [fieldsName]: value.map((item) => ({
        referenceName: item.referenceName,
        description: item.description,
      })),
    });
  };

  return (
    <>
      <EditBasicMetadata
        dataSource={{ displayName, description }}
        onChange={onChange}
        nodeType={nodeType}
        rules={{
          // View display name changing will trigger re-generate reference name
          // So we need to validate the display name
          displayName: [
            {
              required: true,
              validator: createViewNameValidator(validateViewMutation),
            },
          ],
        }}
      />

      <div className="mb-6">
        <Typography.Text className="d-block gray-7 mb-2">
          Columns ({fields.length})
        </Typography.Text>
        <FieldEditableTable
          dataSource={fields}
          columns={[
            COLUMN.NAME,
            { ...COLUMN.TYPE },
            { ...COLUMN.DESCRIPTION, width: 280 },
          ]}
          onChange={handleMetadataChange(FIELDS_NAME.FIELDS)}
        />
      </div>
    </>
  );
}
