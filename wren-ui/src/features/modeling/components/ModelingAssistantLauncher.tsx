import { useMemo, useState } from 'react';
import { Button, Tag, Typography } from 'antd';
import { BulbOutlined, DownOutlined, RightOutlined } from '@ant-design/icons';
import styled from 'styled-components';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import { Path } from '@/utils/enum';

const { Paragraph, Text } = Typography;

const LauncherCard = styled.div`
  border: 1px solid var(--nova-outline-soft);
  border-radius: 18px;
  background: linear-gradient(180deg, #ffffff 0%, #faf8ff 100%);
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.04);
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const LauncherHeaderButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 16px;
  border: 0;
  background: transparent;
  padding: 0;
  cursor: pointer;
`;

const LauncherActions = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const LauncherActionButton = styled(Button)`
  &.ant-btn {
    height: auto;
    min-height: 64px;
    padding: 14px 16px;
    border-radius: 14px;
    border: 1px solid rgba(109, 74, 255, 0.12);
    background: #fff;
    box-shadow: 0 8px 20px rgba(111, 71, 255, 0.08);
  }
`;

const ActionRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
`;

const ActionMeta = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
`;

const items = [
  {
    key: Path.RecommendSemantics,
    title: 'Recommend semantics',
    description: 'Generate model and column descriptions with AI guidance.',
  },
  {
    key: Path.RecommendRelationships,
    title: 'Recommend relationships',
    description:
      'Discover relationship suggestions and review them before saving.',
  },
] as const;

export default function ModelingAssistantLauncher({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const [expanded, setExpanded] = useState(false);

  const actionButtons = useMemo(
    () =>
      items.map((item) => (
        <LauncherActionButton
          key={item.key}
          block
          disabled={disabled}
          onClick={() => runtimeScopeNavigation.pushWorkspace(item.key)}
        >
          <ActionRow>
            <ActionMeta>
              <Text strong>{item.title}</Text>
              <Text type="secondary">{item.description}</Text>
            </ActionMeta>
            <Tag color="processing">AI</Tag>
          </ActionRow>
        </LauncherActionButton>
      )),
    [runtimeScopeNavigation],
  );

  return (
    <LauncherCard data-guideid="modeling-copilot">
      <LauncherHeaderButton
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(109, 74, 255, 0.12)',
              color: '#6d4aff',
              flex: '0 0 auto',
            }}
          >
            <BulbOutlined />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Text strong style={{ fontSize: 16 }}>
              Modeling AI Assistant
            </Text>
            <Paragraph
              style={{ marginBottom: 0, color: '#667085', maxWidth: 720 }}
            >
              Improve accuracy by setting up semantics and relationships with
              AI-guided workflows.
            </Paragraph>
          </div>
        </div>
        {expanded ? <DownOutlined /> : <RightOutlined />}
      </LauncherHeaderButton>
      {expanded ? <LauncherActions>{actionButtons}</LauncherActions> : null}
    </LauncherCard>
  );
}
