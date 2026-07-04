import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { Button, Dropdown, Layout, Menu, Space } from 'antd';
import styled from 'styled-components';
import LogoBar from '@/components/LogoBar';
import { Path } from '@/utils/enum';
import Deploy from '@/components/deploy/Deploy';
import OrganizationSwitcher from '@/components/OrganizationSwitcher';

const { Header } = Layout;

const StyledButton = styled(Button)<{ $isHighlight: boolean }>`
  background: ${(props) =>
    props.$isHighlight ? 'rgba(255, 255, 255, 0.20)' : 'transparent'};
  font-weight: ${(props) => (props.$isHighlight ? '700' : 'normal')};
  border: none;
  color: var(--gray-1);

  &:hover,
  &:focus {
    background: ${(props) =>
      props.$isHighlight
        ? 'rgba(255, 255, 255, 0.20)'
        : 'rgba(255, 255, 255, 0.05)'};
    color: var(--gray-1);
  }
`;

const StyledHeader = styled(Header)`
  height: 48px;
  border-bottom: 1px solid var(--gray-5);
  background: var(--gray-10);
  padding: 10px 16px;
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 48px;
`;

const HeaderCenter = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-width: 0;
`;

const HeaderRight = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  min-width: 120px;
`;

const UserAvatar = styled.div`
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background: var(--geekblue-6);
  color: var(--gray-1);
  font-weight: 600;
  line-height: 1;
`;

interface CurrentUserProfile {
  name?: string;
  email?: string;
}

export default function HeaderBar() {
  const router = useRouter();
  const { pathname } = router;
  const currentPath = router.asPath.split(/[?#]/)[0];
  const showNav = !pathname.startsWith(Path.Onboarding);
  const isModeling = pathname.startsWith(Path.Modeling);
  const navigateTo = (path: Path) => {
    if (currentPath !== path) {
      router.push(path);
    }
  };
  const [currentUser, setCurrentUser] = useState<CurrentUserProfile | null>(
    null,
  );

  useEffect(() => {
    if (!showNav) return;

    const loadCurrentUser = async () => {
      try {
        const response = await fetch('/api/v1/users/current');
        if (!response.ok) return;
        const payload = (await response.json()) as CurrentUserProfile;
        setCurrentUser(payload);
      } catch {
        setCurrentUser(null);
      }
    };

    loadCurrentUser();
  }, [showNav]);

  const userInitials = useMemo(() => {
    const displayName = currentUser?.name || currentUser?.email || 'User';
    const parts = displayName.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'U';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }, [currentUser]);

  const userMenu = (
    <Menu>
      <Menu.Item key="profile" onClick={() => router.push(Path.UserProfile)}>
        {currentUser?.email || 'Profile'}
      </Menu.Item>
    </Menu>
  );

  return (
    <StyledHeader>
      <div
        className="d-flex justify-space-between align-center"
        style={{ marginTop: -2 }}
      >
        <HeaderLeft>
          <LogoBar />
          {showNav && (
            <Space size={[16, 0]}>
              <StyledButton
                shape="round"
                size="small"
                $isHighlight={pathname.startsWith(Path.Home)}
                onClick={() => navigateTo(Path.Home)}
              >
                Home
              </StyledButton>
              <StyledButton
                shape="round"
                size="small"
                $isHighlight={pathname.startsWith(Path.Modeling)}
                onClick={() => navigateTo(Path.Modeling)}
              >
                Modeling
              </StyledButton>
              <StyledButton
                shape="round"
                size="small"
                $isHighlight={pathname.startsWith(Path.Knowledge)}
                onClick={() => navigateTo(Path.KnowledgeQuestionSQLPairs)}
              >
                Knowledge
              </StyledButton>
              <StyledButton
                shape="round"
                size="small"
                $isHighlight={pathname.startsWith(Path.APIManagement)}
                onClick={() => navigateTo(Path.APIManagementHistory)}
              >
                API
              </StyledButton>
            </Space>
          )}
        </HeaderLeft>
        <HeaderCenter>{showNav && <OrganizationSwitcher />}</HeaderCenter>
        <HeaderRight>
          {isModeling && <Deploy />}
          {showNav && (
            <Dropdown
              overlay={userMenu}
              trigger={['click']}
              placement="bottomRight"
            >
              <UserAvatar>{userInitials}</UserAvatar>
            </Dropdown>
          )}
        </HeaderRight>
      </div>
    </StyledHeader>
  );
}
