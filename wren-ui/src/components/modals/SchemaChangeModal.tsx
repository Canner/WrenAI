import { useMemo } from 'react';
import {
  Modal,
  Button,
  Table,
  Typography,
  Collapse,
  Alert,
  Tag,
  Popconfirm,
} from 'antd';
import styled from 'styled-components';
import WarningOutlined from '@ant-design/icons/WarningOutlined';
import PlusSquareOutlined from '@ant-design/icons/PlusSquareOutlined';
import LineOutlined from '@ant-design/icons/LineOutlined';
import FileDoneOutlined from '@ant-design/icons/FileDoneOutlined';
import { ModalAction } from '@/hooks/useModalAction';
import EllipsisWrapper from '@/components/EllipsisWrapper';
import {
  DetailedChangeTable,
  DetailedAffectedCalculatedFields,
  DetailedAffectedRelationships,
  NodeType,
  SchemaChange,
  SchemaChangeType,
} from '@/apollo/client/graphql/__types__';

const StyledCollapse = styled(Collapse)`
  border: none;
  background-color: white;
  .ant-collapse-item:last-child,
  .ant-collapse-item:last-child > .ant-collapse-header {
    border-radius: 0;
  }
  .ant-collapse-item,
  .ant-collapse-content {
    border-color: var(--gray-4);
  }
  .ant-collapse-content-box {
    padding: 0;
  }
`;

const StyledTable = styled(Table)`
  padding-left: 36px;
  .ant-table {
    border: none;
    border-radius: 0;

    .non-expandable {
      .ant-table-row-expand-icon {
        display: none;
      }
    }

    .ant-table-expanded-row {
      .ant-table-cell {
        background-color: white;
      }
    }
  }
`;

type Props = ModalAction<SchemaChange> & {
  loading?: boolean;
  payload?: {
    onResolveSchemaChange?: (type: SchemaChangeType) => void;
    isResolving?: boolean;
  };
};

const nestedColumns = [
  {
    title: 'Affected Resource',
    dataIndex: 'resourceType',
    width: 200,
    render: (resourceType: NodeType) => {
      if (resourceType === NodeType.CALCULATED_FIELD) {
        return <Tag className="ant-tag--geekblue">Calculated Field</Tag>;
      }

      if (resourceType === NodeType.RELATION) {
        return <Tag className="ant-tag--citrus">Relationship</Tag>;
      }

      return null;
    },
  },
  {
    title: 'Name',
    dataIndex: 'displayName',
  },
];

const checkIsExpandable = (record: DetailedChangeTable) =>
  record.calculatedFields.length + record.relationships.length > 0
    ? ''
    : 'non-expandable';

const PanelHeader = (props) => {
  const { title, count, onResolve, isResolving } = props;
  const resolve = (event) => {
    event.stopPropagation();
    onResolve();
  };
  return (
    <div
      className="d-flex align-center flex-grow-1"
      style={{ userSelect: 'none' }}
    >
      <b className="text-medium">{title}</b>
      <span className="flex-grow-1 text-right d-flex justify-end">
        <Typography.Text className="gray-6">
          {count} table(s) affected
        </Typography.Text>
        <div style={{ width: 150 }}>
          {!!onResolve && (
            <Popconfirm
              title="Are you sure?"
              okText="Confirm"
              okButtonProps={{ danger: true }}
              onConfirm={resolve}
              onCancel={(event) => event.stopPropagation()}
            >
              <Button
                type="text"
                size="small"
                className="red-5"
                onClick={(event) => event.stopPropagation()}
                loading={isResolving}
                icon={<FileDoneOutlined />}
              >
                Resolve
              </Button>
            </Popconfirm>
          )}
        </div>
      </span>
    </div>
  );
};

interface ExpandedRowsProps {
  record: DetailedChangeTable & {
    resources: Array<
      DetailedAffectedCalculatedFields | DetailedAffectedRelationships
    >;
  };
  tipMessage: string;
}

const ExpandedRows = ({ record, tipMessage }: ExpandedRowsProps) => {
  if (record.resources.length === 0) return null;

  return (
    <div className="pl-12">
      <Alert
        showIcon
        icon={<WarningOutlined className="orange-5" />}
        className="gray-6 ml-2 bg-gray-1 pl-0"
        style={{ border: 'none' }}
        message={tipMessage}
      />
      <Table
        columns={nestedColumns}
        dataSource={record.resources || []}
        pagination={{
          hideOnSinglePage: true,
          size: 'small',
          pageSize: 10,
        }}
        rowKey="rowKey"
        size="small"
        className="adm-nested-table"
      />
    </div>
  );
};

export default function SchemaChangeModal(props: Props) {
  const { visible, onClose, defaultValue: schemaChange, payload } = props;
  const { onResolveSchemaChange, isResolving } = payload || {};

  const { deletedTables, deletedColumns, modifiedColumns } = useMemo(() => {
    const { deletedTables, deletedColumns, modifiedColumns } =
      schemaChange || {};

    if (!schemaChange)
      return {
        deletedTables,
        deletedColumns,
        modifiedColumns,
      };

    // transform data to render UI
    const transformData = (tables: DetailedChangeTable) => ({
      ...tables,
      resources: [
        ...tables.calculatedFields.map(
          (
            calculatedField: DetailedAffectedCalculatedFields,
            index: number,
          ) => ({
            ...calculatedField,
            resourceType: NodeType.CALCULATED_FIELD,
            rowKey: `${tables.sourceTableName}-${calculatedField.referenceName}-${index}`,
          }),
        ),
        ...tables.relationships.map(
          (relationship: DetailedAffectedRelationships, index: number) => ({
            ...relationship,
            resourceType: NodeType.RELATION,
            rowKey: `${tables.sourceTableName}-${relationship.referenceName}-${index}`,
          }),
        ),
      ],
      rowKey: tables.sourceTableName,
    });

    return {
      deletedTables: deletedTables?.map(transformData),
      deletedColumns: deletedColumns?.map(transformData),
      modifiedColumns: modifiedColumns?.map(transformData),
    };
  }, [schemaChange]);

  const columnsOfDeleteTables = [
    { title: 'Affected model', width: 200, dataIndex: 'displayName' },
    { title: 'Source table name', dataIndex: 'sourceTableName' },
  ];

  const columnsOfDeletedColumns = [
    { title: 'Affected model', width: 200, dataIndex: 'displayName' },
    {
      title: 'Deleted columns',
      dataIndex: 'columns',
      render: (columns) => {
        return (
          <EllipsisWrapper showMoreCount>
            {columns.map((column) => (
              <Tag className="ant-tag--geekblue" key={column.sourceColumnName}>
                {column.displayName}
              </Tag>
            ))}
          </EllipsisWrapper>
        );
      },
    },
  ];

  const columnsOfModifiedColumns = [
    { title: 'Affected model', width: 200, dataIndex: 'displayName' },
    {
      title: 'Affected columns',
      dataIndex: 'columns',
      render: (columns) => {
        return (
          <EllipsisWrapper showMoreCount>
            {columns.map((column) => (
              <Tag className="ant-tag--geekblue" key={column.sourceColumnName}>
                {column.displayName}
              </Tag>
            ))}
          </EllipsisWrapper>
        );
      },
    },
  ];

  return (
    <Modal
      title={
        <>
          <WarningOutlined className="orange-5 mr-2" />
          Schema Changes
        </>
      }
      width={750}
      visible={visible}
      onCancel={onClose}
      destroyOnClose
      footer={null}
    >
      <Typography.Paragraph className="gray-6 mb-4">
        We have detected schema changes from your connected data source. Please
        review the impacts of these changes.
      </Typography.Paragraph>
      <Alert
        showIcon
        type="warning"
        className="gray-8 mb-6"
        message={`Please note that clicking \"Resolve\" may automatically delete all affected models, relationships, and calculated fields.`}
      />
      <StyledCollapse
        expandIcon={(panelProps) =>
          panelProps.isActive ? <LineOutlined /> : <PlusSquareOutlined />
        }
      >
        {deletedTables && (
          <Collapse.Panel
            header={
              <PanelHeader
                title="Source table deleted"
                count={deletedTables.length}
                onResolve={() =>
                  onResolveSchemaChange(SchemaChangeType.DELETED_TABLES)
                }
                isResolving={isResolving}
              ></PanelHeader>
            }
            key="deleteTables"
          >
            <StyledTable
              rowKey="rowKey"
              columns={columnsOfDeleteTables}
              dataSource={deletedTables}
              size="small"
              pagination={{
                hideOnSinglePage: true,
                size: 'small',
                pageSize: 10,
              }}
              rowClassName={checkIsExpandable}
              expandable={{
                expandedRowRender: (record: ExpandedRowsProps['record']) => (
                  <ExpandedRows
                    record={record}
                    tipMessage="The following table shows resources affected by this model and will be deleted when resolving."
                  />
                ),
              }}
            />
          </Collapse.Panel>
        )}
        {deletedColumns && (
          <Collapse.Panel
            header={
              <PanelHeader
                title="Source column deleted"
                count={deletedColumns.length}
                onResolve={() =>
                  onResolveSchemaChange(SchemaChangeType.DELETED_COLUMNS)
                }
                isResolving={isResolving}
              ></PanelHeader>
            }
            key="deleteColumns"
          >
            <StyledTable
              rowKey="rowKey"
              columns={columnsOfDeletedColumns}
              dataSource={deletedColumns}
              size="small"
              pagination={{
                hideOnSinglePage: true,
                size: 'small',
                pageSize: 10,
              }}
              rowClassName={checkIsExpandable}
              expandable={{
                expandedRowRender: (record: ExpandedRowsProps['record']) => (
                  <ExpandedRows
                    record={record}
                    tipMessage="The following table shows resources affected by this column of the model and will be deleted when resolving."
                  />
                ),
              }}
            />
          </Collapse.Panel>
        )}
        {modifiedColumns && (
          <Collapse.Panel
            header={
              <PanelHeader
                title="Source column type changed"
                count={modifiedColumns.length}
              ></PanelHeader>
            }
            key="modifiedColumns"
          >
            <StyledTable
              rowKey="rowKey"
              columns={columnsOfModifiedColumns}
              dataSource={modifiedColumns}
              size="small"
              pagination={{
                hideOnSinglePage: true,
                size: 'small',
                pageSize: 10,
              }}
              rowClassName={checkIsExpandable}
              expandable={{
                expandedRowRender: (record: ExpandedRowsProps['record']) => (
                  <ExpandedRows
                    record={record}
                    tipMessage="The following table shows the resources utilized by this column of the model. Please review each resource and manually update the relevant ones if any changes are required."
                  />
                ),
              }}
            />
          </Collapse.Panel>
        )}
      </StyledCollapse>
    </Modal>
  );
}
