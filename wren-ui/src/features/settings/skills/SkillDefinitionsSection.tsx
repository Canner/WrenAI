import Link from 'next/link';
import { Button, Card, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import {
  getInstalledFromLabel,
  type ConnectorView,
} from '@/features/settings/skills/skillsPageUtils';
import type { SkillDefinitionView } from '@/utils/skillsRest';

const { Paragraph, Text } = Typography;

export default function SkillDefinitionsSection({
  skillDefinitions,
  connectors,
  connectorsHref,
  currentKnowledgeBaseId,
  currentKnowledgeBaseName,
  canCreateSkill,
  canUpdateSkill,
  canDeleteSkill,
  togglingSkillId,
  deletingSkillId,
  onOpenCreateDefinitionModal,
  onOpenEditDefinitionModal,
  onToggleSkill,
  onDeleteSkill,
}: {
  skillDefinitions: SkillDefinitionView[];
  connectors: ConnectorView[];
  connectorsHref: string;
  currentKnowledgeBaseId?: string | null;
  currentKnowledgeBaseName?: string | null;
  canCreateSkill: boolean;
  canUpdateSkill: boolean;
  canDeleteSkill: boolean;
  togglingSkillId: string | null;
  deletingSkillId: string | null;
  onOpenCreateDefinitionModal: () => void;
  onOpenEditDefinitionModal: (definition: SkillDefinitionView) => void;
  onToggleSkill: (definition: SkillDefinitionView) => void;
  onDeleteSkill: (skillId: string) => Promise<void>;
}) {
  return (
    <Card
      title="我的技能"
      extra={
        <Space wrap>
          <Link href={connectorsHref}>管理连接器</Link>
          <Button
            type="primary"
            onClick={onOpenCreateDefinitionModal}
            disabled={!canCreateSkill}
          >
            添加技能
          </Button>
        </Space>
      }
    >
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        在 workspace runtime skill 上直接维护 instruction、execution
        mode、connector 与 KB 推荐。
      </Text>

      {connectors.length === 0 ? (
        <Paragraph type="secondary">
          当前还没有配置连接器。{' '}
          <Link href={connectorsHref}>立即创建连接器</Link>
          ，当技能需要 API、数据库或工具端点时即可直接复用。
        </Paragraph>
      ) : null}

      <Table
        rowKey="id"
        locale={{ emptyText: '暂无技能' }}
        pagination={{ hideOnSinglePage: true, pageSize: 10 }}
        dataSource={skillDefinitions}
        columns={[
          {
            title: '技能',
            dataIndex: 'name',
            render: (value: string, record: SkillDefinitionView) => (
              <Space direction="vertical" size={0}>
                <Space wrap size={8}>
                  <Text strong>{value}</Text>
                  <Tag>{getInstalledFromLabel(record.installedFrom)}</Tag>
                  {record.catalogId ? <Tag color="purple">catalog</Tag> : null}
                </Space>
                <Text type="secondary">
                  {record.runtimeKind} / {record.sourceType}
                </Text>
              </Space>
            ),
          },
          {
            title: '运行时配置',
            render: (_: unknown, record: SkillDefinitionView) => (
              <Space direction="vertical" size={0}>
                <Text>执行模式：{record.executionMode || 'inject_only'}</Text>
                <Text type="secondary">
                  连接器：{record.connectorId || '无'}
                  {record.hasSecret ? ' · 已配置密钥' : ''}
                </Text>
              </Space>
            ),
          },
          {
            title: '指令 / 推荐范围',
            render: (_: unknown, record: SkillDefinitionView) => (
              <Space direction="vertical" size={0}>
                <Paragraph ellipsis={{ rows: 2 }} className="mb-0">
                  {record.instruction || '未设置 instruction'}
                </Paragraph>
                <Text type="secondary">
                  推荐知识库：
                  {record.kbSuggestionIds?.length
                    ? record.kbSuggestionIds
                        .map((knowledgeBaseId) => {
                          if (currentKnowledgeBaseId === knowledgeBaseId) {
                            return currentKnowledgeBaseName || knowledgeBaseId;
                          }

                          return knowledgeBaseId;
                        })
                        .join(' / ')
                    : '全工作区'}
                </Text>
              </Space>
            ),
          },
          {
            title: '状态',
            width: 140,
            render: (_: unknown, record: SkillDefinitionView) => (
              <Space direction="vertical" size={4}>
                {record.isEnabled !== false ? (
                  <Tag color="green">启用</Tag>
                ) : (
                  <Tag>停用</Tag>
                )}
                {record.migrationSourceBindingId ? (
                  <Tag color="gold">迁移映射</Tag>
                ) : null}
              </Space>
            ),
          },
          {
            title: '操作',
            key: 'actions',
            width: 280,
            render: (_: unknown, record: SkillDefinitionView) => (
              <Space wrap>
                <Button
                  onClick={() => onOpenEditDefinitionModal(record)}
                  disabled={!canUpdateSkill}
                >
                  编辑
                </Button>
                <Button
                  loading={togglingSkillId === record.id}
                  onClick={() => onToggleSkill(record)}
                  disabled={!canUpdateSkill}
                >
                  {record.isEnabled !== false ? '停用' : '启用'}
                </Button>
                <Popconfirm
                  title="确认删除这个技能吗？"
                  onConfirm={async () => {
                    await onDeleteSkill(record.id);
                  }}
                  disabled={!canDeleteSkill}
                >
                  <Button
                    danger
                    disabled={!canDeleteSkill}
                    loading={deletingSkillId === record.id}
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
