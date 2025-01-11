import { Layout } from 'antd';
import styled, { css } from 'styled-components';
import SimpleLayout from '@/components/layouts/SimpleLayout';
import Sidebar from '@/components/sidebar';
import Settings from '@/components/settings';
import useModalAction from '@/hooks/useModalAction';

const { Sider } = Layout;

const basicStyle = css`
  height: calc(100vh - 48px);
  overflow: auto;
`;

const StyledContentLayout = styled(Layout)<{ color?: string }>`
  position: relative;
  ${basicStyle}
  ${(props) => props.color && `background-color: var(--${props.color});`}
`;

const StyledSider = styled(Sider)`
  ${basicStyle}
`;

type Props = React.ComponentProps<typeof SimpleLayout> & {
  sidebar: React.ComponentProps<typeof Sidebar>;
  color?: string;
};

export default function SiderLayout(props: Props) {
  const { sidebar, loading, color } = props;
  const settings = useModalAction();

  return (
    <SimpleLayout loading={loading}>
      <Layout className="adm-layout">
        <StyledSider width={280}>
          <Sidebar {...sidebar} onOpenSettings={settings.openModal} />
        </StyledSider>
        <StyledContentLayout color={color}>
          {props.children}
        </StyledContentLayout>
      </Layout>
      <Settings {...settings.state} onClose={settings.closeModal} />
    </SimpleLayout>
  );
}
