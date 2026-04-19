import { Button, Card, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import {
  DATABASE_PROVIDER_OPTIONS,
  type ConnectorView,
} from './connectorsPageUtils';

const { Paragraph, Text } = Typography;

const DATABASE_PROVIDER_LABELS = Object.fromEntries(
  DATABASE_PROVIDER_OPTIONS.map((option) => [option.value, option.label]),
);

type ConnectorsCatalogSectionProps = {
  connectors: ConnectorView[];
  configuredSecretCount: number;
  testingConnectorId?: string | null;
  createConnectorBlockedReason?: string | null;
  updateConnectorBlockedReason?: string | null;
  deleteConnectorBlockedReason?: string | null;
  rotateConnectorSecretBlockedReason?: string | null;
  onOpenSecretOpsModal: () => void;
  onOpenCreateModal: () => void;
  onOpenEditModal: (connector: ConnectorView) => void;
  onTestSavedConnector: (connector: ConnectorView) => void | Promise<void>;
  onDeleteConnector: (connectorId: string) => void | Promise<void>;
};

export default function ConnectorsCatalogSection({
  connectors,
  configuredSecretCount,
  testingConnectorId,
  createConnectorBlockedReason,
  updateConnectorBlockedReason,
  deleteConnectorBlockedReason,
  rotateConnectorSecretBlockedReason,
  onOpenSecretOpsModal,
  onOpenCreateModal,
  onOpenEditModal,
  onTestSavedConnector,
  onDeleteConnector,
}: ConnectorsCatalogSectionProps) {
  return (
    <Card>
      <Space
        align="start"
        size={16}
        style={{
          width: '100%',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
        wrap
      >
        <Space direction="vertical" size={4} style={{ maxWidth: 640 }}>
          <Text strong>连接器目录</Text>
          <Text type="secondary">
            {connectors.length > 0
              ? `当前共 ${connectors.length} 个连接器，${configuredSecretCount} 个已配置密钥。`
              : '统一管理工作区可复用的 API、数据库与工具端点。'}
          </Text>
        </Space>
        <Space wrap>
          {configuredSecretCount > 0 ? (
            <Button
              onClick={onOpenSecretOpsModal}
              disabled={Boolean(rotateConnectorSecretBlockedReason)}
            >
              批量轮换密钥
            </Button>
          ) : null}
          <Button
            type="primary"
            onClick={onOpenCreateModal}
            disabled={Boolean(createConnectorBlockedReason)}
          >
            添加连接器
          </Button>
        </Space>
      </Space>

      <Table
        rowKey="id"
        dataSource={connectors}
        locale={{ emptyText: '暂无数据' }}
        pagination={{ hideOnSinglePage: true, pageSize: 10 }}
        columns={[
          {
            title: '连接器',
            dataIndex: 'displayName',
            render: (value: string, record: ConnectorView) => (
              <Space direction="vertical" size={0}>
                <Text strong>{value}</Text>
                <Space size={6}>
                  <Text type="secondary">{record.type}</Text>
                  {record.trinoCatalogName ? (
                    <Tag color="purple" style={{ marginInlineEnd: 0 }}>
                      {record.trinoCatalogName}
                    </Tag>
                  ) : null}
                </Space>
              </Space>
            ),
          },
          {
            title: '数据库类型',
            dataIndex: 'databaseProvider',
            width: 160,
            render: (
              value: ConnectorView['databaseProvider'],
              record: ConnectorView,
            ) =>
              record.type === 'database' && value ? (
                <Tag style={{ marginInlineEnd: 0 }}>
                  {DATABASE_PROVIDER_LABELS[value] || value}
                </Tag>
              ) : (
                <Text type="secondary">—</Text>
              ),
          },
          {
            title: '配置',
            dataIndex: 'config',
            render: (value: Record<string, any> | null | undefined) =>
              value ? (
                <Paragraph
                  style={{
                    marginBottom: 0,
                    whiteSpace: 'pre-wrap',
                    fontFamily:
                      'ui-monospace, SFMono-Regular, SFMono-Regular, Consolas, monospace',
                  }}
                  ellipsis={{ rows: 4, expandable: true, symbol: '展开' }}
                >
                  {JSON.stringify(value, null, 2)}
                </Paragraph>
              ) : (
                <Text type="secondary">—</Text>
              ),
          },
          {
            title: '密钥',
            dataIndex: 'hasSecret',
            width: 120,
            render: (hasSecret: boolean | undefined) =>
              hasSecret ? <Tag color="green">已配置</Tag> : <Tag>未配置</Tag>,
          },
          {
            title: '操作',
            key: 'actions',
            width: 160,
            render: (_: any, record: ConnectorView) => (
              <Space>
                <Button
                  onClick={() => onOpenEditModal(record)}
                  disabled={Boolean(updateConnectorBlockedReason)}
                >
                  编辑
                </Button>
                <Button
                  onClick={() => void onTestSavedConnector(record)}
                  loading={testingConnectorId === record.id}
                  disabled={
                    Boolean(updateConnectorBlockedReason) ||
                    record.type !== 'database'
                  }
                >
                  测试
                </Button>
                <Popconfirm
                  title="确认删除这个连接器吗？"
                  onConfirm={() => void onDeleteConnector(record.id)}
                  disabled={Boolean(deleteConnectorBlockedReason)}
                >
                  <Button
                    danger
                    disabled={Boolean(deleteConnectorBlockedReason)}
                  >
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
    </Card>
  );
}
