import { Button, Card, Space, Table, Tag, Typography } from 'antd';
import type { SkillMarketplaceCatalogView } from '@/utils/skillsRest';

const { Paragraph, Text } = Typography;

export default function SkillsMarketplaceSection({
  marketplaceCatalogSkills,
  installedCatalogIds,
  canCreateSkill,
  installingCatalogId,
  skillManagementBlockedReason,
  onInstallSkill,
}: {
  marketplaceCatalogSkills: SkillMarketplaceCatalogView[];
  installedCatalogIds: Set<string>;
  canCreateSkill: boolean;
  installingCatalogId: string | null;
  skillManagementBlockedReason: string | null;
  onInstallSkill: (catalogId: string) => void;
}) {
  return (
    <Card title="技能市场">
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        平台 catalog 只负责发布来源；安装后会物化成工作区自己的 runtime skill。
      </Text>

      {skillManagementBlockedReason ? (
        <Paragraph type="secondary">{skillManagementBlockedReason}</Paragraph>
      ) : null}

      <Table
        rowKey="id"
        locale={{ emptyText: '暂无可安装技能' }}
        pagination={{ hideOnSinglePage: true, pageSize: 10 }}
        dataSource={marketplaceCatalogSkills}
        columns={[
          {
            title: '技能',
            dataIndex: 'name',
            render: (value: string, record: SkillMarketplaceCatalogView) => (
              <Space orientation="vertical" size={0}>
                <Text strong>{value}</Text>
                <Text type="secondary">
                  {record.category || '未分类'} / {record.runtimeKind}
                </Text>
              </Space>
            ),
          },
          {
            title: '默认行为',
            render: (_: unknown, record: SkillMarketplaceCatalogView) => (
              <Space orientation="vertical" size={0}>
                <Text>
                  执行模式：{record.defaultExecutionMode || 'inject_only'}
                </Text>
                <Text type="secondary">{record.description || '无描述'}</Text>
              </Space>
            ),
          },
          {
            title: '状态',
            width: 120,
            render: (_: unknown, record: SkillMarketplaceCatalogView) =>
              installedCatalogIds.has(record.id) ? (
                <Tag color="green">已安装</Tag>
              ) : record.isBuiltin ? (
                <Tag color="blue">内置</Tag>
              ) : (
                <Tag>可安装</Tag>
              ),
          },
          {
            title: '操作',
            width: 120,
            render: (_: unknown, record: SkillMarketplaceCatalogView) => (
              <Button
                type="primary"
                disabled={installedCatalogIds.has(record.id) || !canCreateSkill}
                loading={installingCatalogId === record.id}
                onClick={() => onInstallSkill(record.id)}
              >
                {installedCatalogIds.has(record.id) ? '已安装' : '安装'}
              </Button>
            ),
          },
        ]}
      />
    </Card>
  );
}
