import { useRouter } from 'next/router';
import styled from 'styled-components';
import { Button, ButtonProps, Layout, Space } from 'antd';
import LogoBar from '@/components/LogoBar';
import { Path } from '@/utils/enum';

const { Header } = Layout;

const StyledButton = styled(Button).attrs<{
  $isHighlight: boolean;
}>((props) => ({
  shape: 'round',
  size: 'small',
  style: {
    background: props.$isHighlight ? 'rgba(255, 255, 255, 0.20)' : '#000',
    fontWeight: props.$isHighlight ? '700' : 'normal',
    border: 'none',
    color: 'var(--gray-1)',
  },
}))`` as React.ForwardRefExoticComponent<
  ButtonProps & React.RefAttributes<HTMLDivElement> & { $isHighlight: boolean }
>;

const StyledHeader = styled(Header)`
  height: 48px;
  border-bottom: 1px solid var(--gray-5);
  background: #000;
  padding: 10px 16px;
`;

export default function HeaderBar() {
  const router = useRouter();
  const { pathname } = router;
  const showNav = !pathname.startsWith(Path.Onboarding);

  return (
    <StyledHeader>
      <div
        className="d-flex justify-space-between"
        style={{ marginTop: -2, alignItems: 'self-end' }}
      >
        <Space size={[48, 0]}>
          <LogoBar />
          {showNav && (
            <Space size={[16, 0]}>
              <StyledButton
                $isHighlight={pathname.startsWith(Path.Home)}
                onClick={() => router.push(Path.Home)}
              >
                Home
              </StyledButton>
              <StyledButton
                $isHighlight={pathname.startsWith(Path.Modeling)}
                onClick={() => router.push(Path.Modeling)}
              >
                Modeling
              </StyledButton>
            </Space>
          )}
        </Space>
      </div>
    </StyledHeader>
  );
}
