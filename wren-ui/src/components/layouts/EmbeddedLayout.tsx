import { Layout } from 'antd';
import styled, { css } from 'styled-components';
import Sidebar from '@/components/sidebar'
import PageLoading from '@/components/PageLoading';
import { useRouter } from 'next/router';
import Home, { Props as HomeSidebarProps } from '@/components/sidebar/Home';
import { useWithOnboarding } from '@/hooks/useCheckOnboarding';
import clsx from 'clsx';

const { Sider, Content } = Layout;

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

interface Props {
  children: React.ReactNode;
  loading?: boolean;
  sidebar?: React.ComponentProps<typeof Sidebar>;
  color?: string;
}


export default function EmbeddedLayout(props: Props) {
  const { children, loading, sidebar } = props;

  const { loading: fetching } = useWithOnboarding();
  const router = useRouter();
  const pageLoading = fetching || loading;

  return (
    <Layout
      className={clsx('adm-main bg-gray-1', {
        'overflow-hidden': pageLoading,
      })}
    >
      <Layout className="adm-layout">
        <StyledSider width={280}>
          <Layout className="d-flex flex-column">
            <Content>
              <Home {...(sidebar as HomeSidebarProps)} />
            </Content>
          </Layout>
        </StyledSider>
        <StyledContentLayout>
          <Content className="adm-content">{children}</Content>
        </StyledContentLayout>
      </Layout>
      <PageLoading visible={pageLoading} />
    </Layout>
  );
}
