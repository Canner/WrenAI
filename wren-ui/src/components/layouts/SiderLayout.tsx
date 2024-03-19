import { Layout } from 'antd';
import styled, { css } from 'styled-components';
import SimpleLayout from '@/components/layouts/SimpleLayout';
import Sidebar from '@/components/sidebar';

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

  return (
    <SimpleLayout loading={loading}>
      <Layout className="adm-layout">
        <StyledSider width={280}>
          <Sidebar {...sidebar} />
        </StyledSider>
        <StyledContentLayout>{props.children}</StyledContentLayout>
      </Layout>
    </SimpleLayout>
  );
}
