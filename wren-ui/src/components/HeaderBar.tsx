import { useRouter } from 'next/router';
import { Button, Layout, Space } from 'antd';
import styled from 'styled-components';
import { useTranslations } from 'next-intl';
import LogoBar from '@/components/LogoBar';
import { Path } from '@/utils/enum';
import Deploy from '@/components/deploy/Deploy';
import { pushWithLocale } from '@/i18n/navigation';

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
  const t = useTranslations();
  const { pathname } = router;
  const showNav = !pathname.startsWith(Path.Onboarding);
  const isModeling = pathname.startsWith(Path.Modeling);

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
                onClick={() => pushWithLocale(router, Path.Home)}
              >
                {t('nav.home')}
              </StyledButton>
              <StyledButton
                shape="round"
                size="small"
                $isHighlight={pathname.startsWith(Path.Modeling)}
                onClick={() => pushWithLocale(router, Path.Modeling)}
              >
                {t('nav.modeling')}
              </StyledButton>
              <StyledButton
                shape="round"
                size="small"
                $isHighlight={pathname.startsWith(Path.Knowledge)}
                onClick={() =>
                  pushWithLocale(router, Path.KnowledgeQuestionSQLPairs)
                }
              >
                {t('nav.knowledge')}
              </StyledButton>
              <StyledButton
                shape="round"
                size="small"
                $isHighlight={pathname.startsWith(Path.APIManagement)}
                onClick={() => pushWithLocale(router, Path.APIManagementHistory)}
              >
                {t('nav.api')}
              </StyledButton>
            </Space>
          )}
        </Space>
        {isModeling && (
          <Space size={[16, 0]}>
            <Deploy />
          </Space>
        )}
      </div>
    </StyledHeader>
  );
}
