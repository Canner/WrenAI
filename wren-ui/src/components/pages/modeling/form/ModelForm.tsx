import { useEffect, useMemo, useState } from 'react';
import { Form, FormInstance, Select, message } from 'antd';
import { TransferItem } from 'antd/es/transfer';
import { isEmpty } from 'lodash';
import { FORM_MODE } from '@/utils/enum';
import { DiagramModelField } from '@/utils/data';
import { ERROR_TEXTS } from '@/utils/error';
import { DrawerAction } from '@/hooks/useDrawerAction';
import { Loading } from '@/components/PageLoading';
import TableTransfer, {
  defaultColumns,
} from '@/components/table/TableTransfer';
import { useListDataSourceTablesQuery } from '@/apollo/client/graphql/dataSource.generated';
import { CompactTable, CompactColumn } from '@/apollo/client/graphql/__types__';
import {
  getCompactTableCatalogLabel,
  getCompactTableQualifiedName,
  getCompactTableScopedName,
} from '@/utils/compactTable';
import useModelList from '@/hooks/useModelList';

const { Option, OptGroup } = Select;

const FormFieldKey = {
  SOURCE_TABLE: 'sourceTableName',
  COLUMNS: 'fields',
  PRIMARY_KEY: 'primaryKey',
};

type Props = Pick<DrawerAction, 'defaultValue' | 'formMode'> & {
  form: FormInstance;
};

const primaryKeyValidator =
  (selectedColumns: string[]) => async (_rule: any, value: string) => {
    if (value && !selectedColumns.includes(value)) {
      return Promise.reject(
        ERROR_TEXTS.MODELING_CREATE_MODEL.PRIMARY_KEY.INVALID,
      );
    }

    return Promise.resolve();
  };

export default function ModelForm(props: Props) {
  const { defaultValue, form, formMode } = props;

  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [sourceTableName, setSourceTableName] = useState<string | undefined>(
    undefined,
  );
  const sourceTableFieldValue = Form.useWatch(FormFieldKey.SOURCE_TABLE, form);

  const isUpdateMode = formMode === FORM_MODE.EDIT;

  const { data: modelListData, loading: listModelsQueryLoading } = useModelList(
    {
      enabled: !isUpdateMode,
      onError: (error) => {
        message.error(error.message || '加载模型列表失败，请稍后重试。');
      },
    },
  );
  const existingModels = modelListData || [];

  const { data, loading: fetching } = useListDataSourceTablesQuery({
    fetchPolicy: 'cache-and-network',
    onError: (error) => {
      message.error(error.message || '加载数据源表失败，请稍后重试。');
    },
  });

  const dataSourceTables = data?.listDataSourceTables || [];
  const inUsedModelList = useMemo(
    () => existingModels.map((model) => model.sourceTableName),
    [existingModels],
  );

  useEffect(() => {
    if (isUpdateMode) return;

    // for create mode, reset selected columns when source table changes
    setSelectedColumns([]);
    form.resetFields([FormFieldKey.PRIMARY_KEY]);
  }, [formMode, sourceTableName]);

  // for create mode
  useEffect(() => {
    if (sourceTableFieldValue) {
      setSourceTableName(sourceTableFieldValue);
    }
  }, [sourceTableFieldValue]);

  const columns: Array<{
    key: string;
    name: string;
    type: string;
  }> = useMemo(() => {
    if (isEmpty(sourceTableName)) return [];

    const table = dataSourceTables.find(
      (table) => table.name === sourceTableName,
    )!;
    if (!table) return [];

    return table.columns.map((column: CompactColumn) => ({
      ...column,
      key: column.name,
    }));
  }, [dataSourceTables, sourceTableName]);

  useEffect(() => {
    if (defaultValue) {
      const fields: string[] = defaultValue.fields
        .map((field: DiagramModelField) => field.referenceName)
        .filter((col: string) => columns.some((c) => c.name === col));

      const primaryKeyField = defaultValue.fields.find(
        (field: DiagramModelField) => field.isPrimaryKey,
      );

      form.setFieldsValue({
        [FormFieldKey.COLUMNS]: fields,
        [FormFieldKey.PRIMARY_KEY]: primaryKeyField?.referenceName,
      });

      setSourceTableName(defaultValue.sourceTableName);
      setSelectedColumns(fields);
    }
  }, [defaultValue, form, columns]);

  const tableOptions: JSX.Element[] = useMemo(() => {
    const groups = new Map<string, CompactTable[]>();

    [...dataSourceTables]
      .sort((left, right) =>
        getCompactTableQualifiedName(left).localeCompare(
          getCompactTableQualifiedName(right),
        ),
      )
      .forEach((table) => {
        const catalogLabel = getCompactTableCatalogLabel(table);
        groups.set(catalogLabel, [...(groups.get(catalogLabel) || []), table]);
      });

    return Array.from(groups.entries()).map(([catalogLabel, tables]) => (
      <OptGroup key={catalogLabel} label={catalogLabel}>
        {tables.map((table) => {
          const disabled = inUsedModelList.includes(table.name);
          const qualifiedName = getCompactTableQualifiedName(table);

          return (
            <Option
              key={table.name}
              value={table.name}
              disabled={disabled}
              title={qualifiedName}
            >
              {getCompactTableScopedName(table)}
            </Option>
          );
        })}
      </OptGroup>
    ));
  }, [dataSourceTables, inUsedModelList]);

  const onChangeColumns = (newKeys: string[]) => setSelectedColumns(newKeys);

  const dataSourceTablesLoading = fetching || listModelsQueryLoading;

  return (
    <>
      <Form form={form} layout="vertical">
        {!isUpdateMode && (
          <div>
            <Form.Item
              label="选择数据表"
              name={FormFieldKey.SOURCE_TABLE}
              required
              rules={[
                {
                  required: true,
                  message: ERROR_TEXTS.MODELING_CREATE_MODEL.TABLE.REQUIRED,
                },
              ]}
            >
              <Select
                getPopupContainer={(trigger) => trigger.parentElement!}
                placeholder="请选择数据表"
                showSearch
                optionFilterProp="title"
                loading={dataSourceTablesLoading}
                disabled={isUpdateMode}
              >
                {tableOptions}
              </Select>
            </Form.Item>
          </div>
        )}
        <Loading spinning={isUpdateMode ? dataSourceTablesLoading : false}>
          <Form.Item
            label="选择字段"
            name={FormFieldKey.COLUMNS}
            rules={[
              {
                required: true,
                message: ERROR_TEXTS.MODELING_CREATE_MODEL.COLUMNS.REQUIRED,
              },
            ]}
          >
            <TableTransfer
              dataSource={columns}
              targetKeys={selectedColumns}
              onChange={onChangeColumns}
              filterOption={(inputValue: string, item: TransferItem) =>
                item.name.toLowerCase().indexOf(inputValue.toLowerCase()) !==
                  -1 ||
                item.type.toLowerCase().indexOf(inputValue.toLowerCase()) !== -1
              }
              leftColumns={defaultColumns}
              rightColumns={defaultColumns}
              titles={['可选字段', '已选字段']}
              showSearch
            />
          </Form.Item>
        </Loading>
        <Form.Item
          label="选择主键"
          name={FormFieldKey.PRIMARY_KEY}
          rules={[
            {
              validator: primaryKeyValidator(selectedColumns),
            },
          ]}
        >
          <Select
            getPopupContainer={(trigger) => trigger.parentElement!}
            placeholder="请选择字段"
            showSearch
            allowClear
          >
            {selectedColumns.map((column) => (
              <Option key={column} value={column}>
                {column}
              </Option>
            ))}
          </Select>
        </Form.Item>
      </Form>
    </>
  );
}
