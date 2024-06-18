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
  }
`;

type Props = ModalAction<SchemaChange> & {
  loading?: boolean;
  payload?: {
    onResolveSchemaChange?: (type: SchemaChangeType) => void;
    isResolving?: boolean;
  };
};

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

export default function SchemaChangeModal(props: Props) {
  const { visible, onClose, defaultValue: schemaChange, payload } = props;
  const { deletedTables, deletedColumns, modifiedColumns } = schemaChange || {};
  const { onResolveSchemaChange, isResolving } = payload || {};

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
              rowKey={(record: any) => record.sourceTableName}
              columns={columnsOfDeleteTables}
              dataSource={deletedTables}
              size="small"
              pagination={{
                hideOnSinglePage: true,
                size: 'small',
                pageSize: 10,
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
              rowKey={(record: any) => record.sourceTableName}
              columns={columnsOfDeletedColumns}
              dataSource={deletedColumns}
              size="small"
              pagination={{
                hideOnSinglePage: true,
                size: 'small',
                pageSize: 10,
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
              rowKey={(record: any) => record.sourceTableName}
              columns={columnsOfModifiedColumns}
              dataSource={modifiedColumns}
              size="small"
              pagination={{
                hideOnSinglePage: true,
                size: 'small',
                pageSize: 10,
              }}
            />
          </Collapse.Panel>
        )}
      </StyledCollapse>
    </Modal>
  );
}
