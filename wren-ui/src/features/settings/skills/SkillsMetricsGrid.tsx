import { Card, Col, Row, Space, Typography } from 'antd';
import {
  getReferenceDisplayKnowledgeName,
  getReferenceDisplayWorkspaceName,
} from '@/utils/referenceDemoKnowledge';

const { Text } = Typography;

function SkillsMetricCard({
  label,
  value,
  description,
}: {
  label: string;
  value: string | number;
  description: string;
}) {
  return (
    <Card>
      <Space orientation="vertical" size={6}>
        <Text type="secondary">{label}</Text>
        <div style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.2 }}>
          {value}
        </div>
        <Text type="secondary">{description}</Text>
      </Space>
    </Card>
  );
}

export default function SkillsMetricsGrid({
  workspaceName,
  knowledgeBaseName,
  skillDefinitionCount,
  enabledSkillCount,
  marketplaceSkillCount,
}: {
  workspaceName?: string | null;
  knowledgeBaseName?: string | null;
  skillDefinitionCount: number;
  enabledSkillCount: number;
  marketplaceSkillCount: number;
}) {
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} md={12} xl={6}>
        <SkillsMetricCard
          label="当前工作区"
          value={getReferenceDisplayWorkspaceName(workspaceName) || '未知'}
          description="技能以工作区级 runtime skill 形式沉淀并跨线程复用。"
        />
      </Col>
      <Col xs={24} md={12} xl={6}>
        <SkillsMetricCard
          label="运行时技能"
          value={skillDefinitionCount}
          description={`已启用 ${enabledSkillCount} 个，市场可安装 ${marketplaceSkillCount} 个。`}
        />
      </Col>
      <Col xs={24} md={12} xl={6}>
        <SkillsMetricCard
          label="当前上下文"
          value={getReferenceDisplayKnowledgeName(knowledgeBaseName) || '未知'}
          description="当前知识库只影响推荐与执行上下文，不再决定技能可用性的硬绑定。"
        />
      </Col>
      <Col xs={24} md={12} xl={6}>
        <SkillsMetricCard
          label="执行模式"
          value="inject_only"
          description="Ask 主链只保留 instruction 注入，不再提供 runner-first 预览路径。"
        />
      </Col>
    </Row>
  );
}
