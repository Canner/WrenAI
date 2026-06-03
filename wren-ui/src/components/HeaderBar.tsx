import { useRouter } from 'next/router';
import { Button, Dropdown, Layout, Menu, Space } from 'antd';
import styled from 'styled-components';
import LogoBar from '@/components/LogoBar';
import { Path } from '@/utils/enum';
import Deploy from '@/components/deploy/Deploy';
import { useAuth } from '@/hooks/useAuth';

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

export default function HeaderBar() {
  const router = useRouter();
  const auth = useAuth();
  const { pathname } = router;
  const showNav = !pathname.startsWith(Path.Onboarding);
  const isModeling = pathname.startsWith(Path.Modeling);
  const roleName = auth.role?.name;
  const isAdmin = roleName === 'Admin';
  const isManager = roleName === 'Manager';
  const isAnalyst = roleName === 'Analyst';
  const canModel = isAdmin || isManager;
  const canUseKnowledge = isAdmin || isManager || isAnalyst;
  const canUseApi = isAdmin || isManager;

  return (
    <StyledHeader>
      <div
        className="d-flex justify-space-between align-center"
        style={{ marginTop: -2 }}
      >
        <Space size={[48, 0]}>
          <LogoBar />
          {showNav && (
            <Space size={[16, 0]}>
              <StyledButton
                shape="round"
                size="small"
                $isHighlight={pathname.startsWith(Path.Home)}
                onClick={() => router.push(Path.Home)}
              >
                Home
              </StyledButton>
              <StyledButton
                shape="round"
                size="small"
                $isHighlight={pathname.startsWith(Path.Modeling)}
                onClick={() => router.push(Path.Modeling)}
                style={{ display: canModel ? undefined : 'none' }}
              >
                Modeling
              </StyledButton>
              <StyledButton
                shape="round"
                size="small"
                $isHighlight={pathname.startsWith(Path.Knowledge)}
                onClick={() => router.push(Path.KnowledgeQuestionSQLPairs)}
                style={{ display: canUseKnowledge ? undefined : 'none' }}
              >
                Knowledge
              </StyledButton>
              <StyledButton
                shape="round"
                size="small"
                $isHighlight={pathname.startsWith(Path.APIManagement)}
                onClick={() => router.push(Path.APIManagementHistory)}
                style={{ display: canUseApi ? undefined : 'none' }}
              >
                API
              </StyledButton>
              <StyledButton
                shape="round"
                size="small"
                $isHighlight={pathname.startsWith(Path.Administration)}
                onClick={() => router.push(Path.AdministrationUsers)}
                style={{ display: isAdmin ? undefined : 'none' }}
              >
                Admin
              </StyledButton>
            </Space>
          )}
        </Space>
        <Space size={[16, 0]}>
          {isModeling && canModel && <Deploy />}
          {auth.authenticated && (
            <Dropdown
              overlay={
                <Menu>
                  <Menu.Item key="role" disabled>
                    {auth.user?.email} - {roleName}
                  </Menu.Item>
                  <Menu.Item key="logout" onClick={() => auth.logout()}>
                    Sign out
                  </Menu.Item>
                </Menu>
              }
              trigger={['click']}
            >
              <Button shape="round" size="small">
                {auth.user?.name || auth.user?.email}
              </Button>
            </Dropdown>
          )}
        </Space>
      </div>
    </StyledHeader>
  );
}
