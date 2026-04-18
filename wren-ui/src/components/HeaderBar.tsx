import { useRouter } from 'next/router';
import { Button, Layout, Space } from 'antd';
import styled from 'styled-components';
import LogoBar from '@/components/LogoBar';
import { Path } from '@/utils/enum';
import Deploy from '@/components/deploy/Deploy';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import {
  buildKnowledgeWorkbenchParams,
  isKnowledgeModelingRoute,
} from '@/utils/knowledgeWorkbench';
import RuntimeScopeSelector from '@/components/runtimeScope/RuntimeScopeSelector';
import AuthSessionStatus from '@/components/auth/AuthSessionStatus';

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
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const { asPath, pathname, query } = router;
  const showNav = !pathname.startsWith(Path.Onboarding);
  const isKnowledgeModeling = isKnowledgeModelingRoute({ pathname, query });
  const isModeling = pathname.startsWith(Path.Modeling) || isKnowledgeModeling;
  const isKnowledge =
    pathname.startsWith(Path.Knowledge) && !isKnowledgeModeling;

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
                onClick={() => runtimeScopeNavigation.pushWorkspace(Path.Home)}
              >
                Home
              </StyledButton>
              <StyledButton
                shape="round"
                size="small"
                $isHighlight={isModeling}
                onClick={() =>
                  runtimeScopeNavigation.pushWorkspace(
                    Path.Knowledge,
                    buildKnowledgeWorkbenchParams('modeling'),
                  )
                }
              >
                Modeling
              </StyledButton>
              <StyledButton
                shape="round"
                size="small"
                $isHighlight={isKnowledge}
                onClick={() =>
                  runtimeScopeNavigation.pushWorkspace(Path.Knowledge)
                }
              >
                Knowledge
              </StyledButton>
              <StyledButton
                shape="round"
                size="small"
                $isHighlight={pathname.startsWith(Path.APIManagement)}
                onClick={() =>
                  runtimeScopeNavigation.pushWorkspace(
                    Path.APIManagementHistory,
                  )
                }
              >
                API
              </StyledButton>
            </Space>
          )}
        </Space>
        {showNav && (
          <Space size={[16, 0]}>
            <RuntimeScopeSelector key={asPath} scope="workspace" />
            {isModeling && <Deploy />}
            <AuthSessionStatus />
          </Space>
        )}
      </div>
    </StyledHeader>
  );
}
