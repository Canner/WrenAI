import { useState } from 'react';
import { useRouter } from 'next/router';
import { Button, Spin, Tag, Typography } from 'antd';
import LogoutOutlined from '@ant-design/icons/LogoutOutlined';
import UserOutlined from '@ant-design/icons/UserOutlined';
import styled from 'styled-components';
import useAuthSession from '@/hooks/useAuthSession';
import { Path } from '@/utils/enum';
import { getReferenceDisplayWorkspaceName } from '@/utils/referenceDemoKnowledge';

const { Text } = Typography;

const CardShell = styled.div<{ $variant: 'inline' | 'card' }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  border-radius: 14px;
  padding: ${(props) => (props.$variant === 'card' ? '12px 14px' : '0')};
  background: ${(props) =>
    props.$variant === 'card' ? 'rgba(255, 255, 255, 0.9)' : 'transparent'};
  border: ${(props) =>
    props.$variant === 'card' ? '1px solid rgba(117, 88, 255, 0.1)' : 'none'};
`;

const Identity = styled.div`
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
`;

const IdentityBadge = styled.div<{ $variant: 'inline' | 'card' }>`
  width: ${(props) => (props.$variant === 'card' ? '36px' : '28px')};
  height: ${(props) => (props.$variant === 'card' ? '36px' : '28px')};
  border-radius: 999px;
  background: rgba(111, 71, 255, 0.12);
  color: #6f47ff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
`;

const IdentityMeta = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const ActionRow = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
`;

interface Props {
  variant?: 'inline' | 'card';
}

const ROLE_LABELS = {
  owner: '所有者',
  admin: '管理员',
  member: '成员',
} as const;
type RoleLabelKey = keyof typeof ROLE_LABELS;

export default function AuthSessionStatus({ variant = 'inline' }: Props) {
  const router = useRouter();
  const authSession = useAuthSession();
  const [submitting, setSubmitting] = useState(false);

  const onLogout = async () => {
    setSubmitting(true);

    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (_error) {
      // ignore network failures and still force auth re-entry
    } finally {
      setSubmitting(false);
      router.push(Path.Auth).catch(() => null);
    }
  };

  if (authSession.loading) {
    return (
      <CardShell $variant={variant}>
        <ActionRow>
          <Spin size="small" />
          <Text type="secondary" style={{ fontSize: 12 }}>
            正在验证身份…
          </Text>
        </ActionRow>
      </CardShell>
    );
  }

  if (!authSession.authenticated) {
    return (
      <CardShell $variant={variant}>
        <Button
          size="small"
          type="default"
          onClick={() => router.push(Path.Auth)}
        >
          去登录
        </Button>
      </CardShell>
    );
  }

  const user = authSession.data?.user;
  const workspace = authSession.data?.workspace;
  const membership = authSession.data?.membership;
  const rawDisplayName = user?.displayName || user?.email || '工作区成员';
  const displayName =
    rawDisplayName === 'Owner' || rawDisplayName === 'owner'
      ? '演示管理员'
      : rawDisplayName;
  const workspaceLabel = getReferenceDisplayWorkspaceName(
    workspace?.name || user?.email,
  );
  const roleKey = membership?.roleKey?.toLowerCase();
  const roleLabel =
    roleKey && roleKey in ROLE_LABELS
      ? ROLE_LABELS[roleKey as RoleLabelKey]
      : membership?.roleKey || null;

  return (
    <CardShell $variant={variant}>
      <Identity>
        <IdentityBadge $variant={variant}>
          <UserOutlined />
        </IdentityBadge>
        <IdentityMeta>
          <Text
            strong
            ellipsis={{ tooltip: displayName }}
            style={{ maxWidth: variant === 'card' ? 160 : 180 }}
          >
            {displayName}
          </Text>
          <Text
            type="secondary"
            ellipsis={{
              tooltip: workspaceLabel || '',
            }}
            style={{ fontSize: 12, maxWidth: variant === 'card' ? 160 : 180 }}
          >
            {workspaceLabel}
          </Text>
        </IdentityMeta>
      </Identity>
      <ActionRow>
        {membership?.roleKey ? (
          <Tag color="purple" style={{ marginInlineEnd: 0, borderRadius: 999 }}>
            {roleLabel}
          </Tag>
        ) : null}
        <Button
          size="small"
          icon={<LogoutOutlined />}
          loading={submitting}
          onClick={onLogout}
        >
          退出
        </Button>
      </ActionRow>
    </CardShell>
  );
}
