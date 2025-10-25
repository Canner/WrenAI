import { useRouter } from 'next/router';
import { Button, Layout, Space, Select } from 'antd';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import LogoBar from '@/components/LogoBar';
import { Path } from '@/utils/enum';
import Deploy from '@/components/deploy/Deploy';

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
  const { pathname } = router;
  const { i18n } = useTranslation();
  const showNav = !pathname.startsWith(Path.Onboarding);
  const isModeling = pathname.startsWith(Path.Modeling);

  const handleLanguageChange = (value: string) => {
    i18n.changeLanguage(value);
    if (value === 'fa') {
      document.documentElement.lang = 'fa';
      document.documentElement.dir = 'rtl';
    } else {
      document.documentElement.lang = 'en';
      document.documentElement.dir = 'ltr';
    }
  };

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
              >
                Modeling
              </StyledButton>
              <StyledButton
                shape="round"
                size="small"
                $isHighlight={pathname.startsWith(Path.Knowledge)}
                onClick={() => router.push(Path.KnowledgeQuestionSQLPairs)}
              >
                Knowledge
              </StyledButton>
              <StyledButton
                shape="round"
                size="small"
                $isHighlight={pathname.startsWith(Path.APIManagement)}
                onClick={() => router.push(Path.APIManagementHistory)}
              >
                API
              </StyledButton>
            </Space>
          )}
        </Space>
        <Space size={[16, 0]}>
          <Select
            defaultValue="en"
            style={{ width: 120 }}
            onChange={handleLanguageChange}
          >
            <Select.Option value="en">English</Select.Option>
            <Select.Option value="fa">فارسی</Select.Option>
          </Select>
          {isModeling && <Deploy />}
        </Space>
      </div>
    </StyledHeader>
  );
}
