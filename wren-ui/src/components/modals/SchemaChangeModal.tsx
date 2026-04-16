import { ReactNode, useMemo } from 'react';
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
import type { PopconfirmProps } from 'antd';
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
  DetailedChangeColumn,
  NodeType,
  SchemaChange,
  SchemaChangeType,
} from '@/types/api';

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
    title: '受影响资源',
    dataIndex: 'resourceType',
    width: 200,
    render: (resourceType: NodeType) => {
      if (resourceType === NodeType.CALCULATED_FIELD) {
        return <Tag className="ant-tag--geekblue">计算字段</Tag>;
      }

      if (resourceType === NodeType.RELATION) {
        return <Tag className="ant-tag--citrus">关系</Tag>;
      }

      return null;
    },
  },
  {
    title: '名称',
    dataIndex: 'displayName',
  },
];

type DetailedChangeTableRow = DetailedChangeTable & {
  resources: Array<
    DetailedAffectedCalculatedFields | DetailedAffectedRelationships
  >;
  rowKey: string;
};

const checkIsExpandable = (record: object) =>
  (record as DetailedChangeTable).calculatedFields.length +
    (record as DetailedChangeTable).relationships.length >
  0
    ? ''
    : 'non-expandable';

interface PanelHeaderProps {
  title: string;
  count: number;
  onResolve?: () => void;
  isResolving?: boolean;
}

const PanelHeader = (props: PanelHeaderProps) => {
  const { title, count, onResolve, isResolving } = props;
  const resolve: PopconfirmProps['onConfirm'] = (event) => {
    event?.stopPropagation();
    onResolve?.();
  };
  const handleCancel: PopconfirmProps['onCancel'] = (event) => {
    event?.stopPropagation();
  };

  return (
    <div
      className="d-flex align-center flex-grow-1"
      style={{ userSelect: 'none' }}
    >
      <b className="text-medium">{title}</b>
      <span className="flex-grow-1 text-right d-flex justify-end">
        <Typography.Text className="gray-6">影响 {count} 张表</Typography.Text>
        <div style={{ width: 150 }}>
          {!!onResolve && (
            <Popconfirm
              title="确认执行修复吗？"
              okText="确认"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={resolve}
              onCancel={handleCancel}
            >
              <Button
                type="text"
                size="small"
                className="red-5"
                onClick={(event) => event.stopPropagation()}
                loading={isResolving}
                icon={<FileDoneOutlined />}
              >
                执行修复
              </Button>
            </Popconfirm>
          )}
        </div>
      </span>
    </div>
  );
};

interface ExpandedRowsProps {
  record: DetailedChangeTableRow;
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
    { title: '受影响模型', width: 200, dataIndex: 'displayName' },
    { title: '源表名称', dataIndex: 'sourceTableName' },
  ];

  const columnsOfDeletedColumns = [
    { title: '受影响模型', width: 200, dataIndex: 'displayName' },
    {
      title: '已删除字段',
      dataIndex: 'columns',
      render: (columns: DetailedChangeColumn[]) => {
        return (
          <EllipsisWrapper showMoreCount>
            {columns.map((column: DetailedChangeColumn) => (
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
    { title: '受影响模型', width: 200, dataIndex: 'displayName' },
    {
      title: '受影响字段',
      dataIndex: 'columns',
      render: (columns: DetailedChangeColumn[]) => {
        return (
          <EllipsisWrapper showMoreCount>
            {columns.map((column: DetailedChangeColumn) => (
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
          结构变更提醒
        </>
      }
      width={750}
      visible={visible}
      onCancel={onClose}
      destroyOnClose
      footer={null}
    >
      <Typography.Paragraph className="gray-6 mb-4">
        我们检测到你连接的数据源发生了 Schema
        变更，请先确认这些变更对当前知识库的影响。
      </Typography.Paragraph>
      <Alert
        showIcon
        type="warning"
        className="gray-8 mb-6"
        message="请注意：点击“执行修复”后，系统可能会自动删除受影响的模型、关系和计算字段。"
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
                title="源表已删除"
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
                expandedRowRender: (record: object): ReactNode => (
                  <ExpandedRows
                    record={record as ExpandedRowsProps['record']}
                    tipMessage="下方列出了受该模型影响的资源；执行修复后，这些资源会被一并删除。"
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
                title="源字段已删除"
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
                expandedRowRender: (record: object): ReactNode => (
                  <ExpandedRows
                    record={record as ExpandedRowsProps['record']}
                    tipMessage="下方列出了受该字段影响的资源；执行修复后，这些资源会被一并删除。"
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
                title="源字段类型已变更"
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
                expandedRowRender: (record: object): ReactNode => (
                  <ExpandedRows
                    record={record as ExpandedRowsProps['record']}
                    tipMessage="下方列出了使用该字段的资源。请逐项检查，并在需要时手动更新对应配置。"
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
