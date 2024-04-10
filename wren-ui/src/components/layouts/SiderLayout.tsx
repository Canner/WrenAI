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

const StyledContentLayout = styled(Layout)`
  position: relative;
  ${basicStyle}
`;

const StyledSider = styled(Sider)`
  ${basicStyle}
`;

type Props = React.ComponentProps<typeof SimpleLayout> & {
  sidebar: React.ComponentProps<typeof Sidebar>;
};

export default function SiderLayout(props: Props) {
  const { sidebar, loading } = props;
  const settings = useModalAction();

  return (
    <SimpleLayout loading={loading}>
      <Layout className="adm-layout">
        <StyledSider width={280}>
          <Sidebar {...sidebar} onOpenSettings={settings.openModal} />
        </StyledSider>
        <StyledContentLayout>{props.children}</StyledContentLayout>
      </Layout>
      <Settings {...settings.state} onClose={settings.closeModal} />
    </SimpleLayout>
  );
}
