import { useRouter } from 'next/router';
import styled from 'styled-components';
import { Button, ButtonProps, Layout, Space } from 'antd';
import LogoBar from '@/components/LogoBar';
import SharePopover from '@/components/SharePopover';
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

export interface Connections {
  database: string;
  port: string;
  username: string;
  password: string;
}

export default function HeaderBar(props: { connections?: Connections }) {
  const { connections = {} as Connections } = props;
  const router = useRouter();
  const { pathname } = router;
  const showNav = !pathname.startsWith(Path.Onboarding);
  const showConnectInfo = pathname.startsWith(Path.Modeling);

  const infoSources = [
    { title: 'Database', type: 'text', value: connections?.database },
    { title: 'Port', type: 'text', value: connections?.port },
    { title: 'Username', type: 'text', value: connections?.username },
    { title: 'Password', type: 'password', value: connections?.password },
  ];

  return (
    <StyledHeader>
      <div
        className="d-flex justify-space-between"
        style={{ marginTop: -2, alignItems: 'self-end' }}
      >
        <Space size={[24, 0]}>
          <LogoBar />
          {showNav && (
            <Space size={[16, 0]}>
              <StyledButton
                $isHighlight={pathname.startsWith(Path.Exploration)}
                onClick={() => router.push(Path.Exploration)}
              >
                Exploration
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
        {showConnectInfo && (
          <SharePopover sources={infoSources}>
            <Button type="primary">Connect</Button>
          </SharePopover>
        )}
      </div>
    </StyledHeader>
  );
}
