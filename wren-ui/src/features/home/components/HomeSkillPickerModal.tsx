import { Alert, Button, Input, Modal, Space, Tag, Typography } from 'antd';
import SearchOutlined from '@ant-design/icons/SearchOutlined';
import type { HomeSkillOption } from '../homeSkillOptions';
import { KnowledgePickerCard, KnowledgePickerList } from '../homePageStyles';
import { getReferenceDisplayKnowledgeName } from '@/utils/referenceDemoKnowledge';

const { Text } = Typography;

type KnowledgeBaseSummary = {
  id: string;
  name?: string | null;
};

type HomeSkillPickerModalProps = {
  open: boolean;
  searchValue: string;
  loading: boolean;
  error: string | null;
  options: HomeSkillOption[];
  selectedSkillIds: string[];
  knowledgeBases: KnowledgeBaseSummary[];
  onSearchChange: (value: string) => void;
  onToggleSkill: (skillId: string) => void;
  onApply: () => void;
  onClose: () => void;
  onNavigateToSkills: () => void;
};

export default function HomeSkillPickerModal({
  open,
  searchValue,
  loading,
  error,
  options,
  selectedSkillIds,
  knowledgeBases,
  onSearchChange,
  onToggleSkill,
  onApply,
  onClose,
  onNavigateToSkills,
}: HomeSkillPickerModalProps) {
  return (
    <Modal
      visible={open}
      title="选择本次对话要启用的技能"
      okText="确认技能范围"
      cancelText="取消"
      onOk={onApply}
      onCancel={onClose}
      width={720}
    >
      <Text type="secondary" style={{ display: 'block', lineHeight: 1.8 }}>
        技能只会在当前 thread
        内生效。你可以按需选择一个或多个技能，让这次问答直接带上对应的分析能力。
      </Text>
      <Input
        style={{ marginTop: 16 }}
        prefix={<SearchOutlined style={{ color: '#98a2b3' }} />}
        placeholder="搜索技能名称、类型或关联知识库"
        value={searchValue}
        onChange={(event) => onSearchChange(event.target.value)}
      />
      <KnowledgePickerList>
        {error ? (
          <Alert
            style={{ marginBottom: 12 }}
            type="error"
            showIcon
            message={error}
          />
        ) : null}
        {loading ? (
          <Text type="secondary">正在加载技能列表…</Text>
        ) : options.length === 0 ? (
          <Space
            direction="vertical"
            size={12}
            style={{ width: '100%', paddingTop: 8 }}
          >
            <Text type="secondary">
              当前工作区还没有可用技能。你可以先去技能管理页安装或创建 runtime
              skill。
            </Text>
            <Button type="default" onClick={onNavigateToSkills}>
              去配置技能
            </Button>
          </Space>
        ) : (
          options.map((skillOption) => {
            const active = selectedSkillIds.includes(skillOption.id);
            const knowledgeSummary = skillOption.knowledgeBaseIds
              .map((knowledgeBaseId) => {
                const matchedKnowledgeBase = knowledgeBases.find(
                  (item) => item.id === knowledgeBaseId,
                );
                return getReferenceDisplayKnowledgeName(
                  matchedKnowledgeBase?.name || knowledgeBaseId,
                );
              })
              .join(' · ');

            return (
              <KnowledgePickerCard
                key={skillOption.id}
                type="button"
                $active={active}
                onClick={() => onToggleSkill(skillOption.id)}
              >
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  <Space align="center" size={10} wrap>
                    <Text strong style={{ fontSize: 15 }}>
                      {skillOption.name}
                    </Text>
                    <Tag
                      style={{
                        marginInlineEnd: 0,
                        borderRadius: 999,
                        borderColor: 'transparent',
                        background: 'rgba(141, 101, 225, 0.08)',
                        color: 'var(--nova-primary)',
                      }}
                    >
                      {skillOption.runtimeKind || 'skill'}
                    </Tag>
                    {active ? (
                      <Tag
                        style={{
                          marginInlineEnd: 0,
                          borderRadius: 999,
                          borderColor: 'transparent',
                          background: 'rgba(15, 23, 42, 0.06)',
                          color: '#4a5263',
                        }}
                      >
                        已选
                      </Tag>
                    ) : null}
                  </Space>
                  <Text type="secondary">
                    推荐知识库：{knowledgeSummary || '全工作区可用'}
                    {skillOption.connectorCount > 0
                      ? ` · ${skillOption.connectorCount} 个连接器`
                      : ''}
                  </Text>
                </Space>
              </KnowledgePickerCard>
            );
          })
        )}
      </KnowledgePickerList>
    </Modal>
  );
}
