import { Layout } from 'antd';
import { Outlet } from 'react-router-dom';
import { TopBar } from './TopBar';
import { ContextualSidebar } from './ContextualSidebar';

/**
 * App shell: top bar + contextual sidebar + canvas. Pages render into the
 * canvas via <Outlet>; navigation is fully client-side (no full reload).
 */
export function AppShell() {
  return (
    <Layout style={{ height: '100vh' }}>
      <TopBar />
      <Layout>
        <ContextualSidebar />
        <Layout.Content style={{ overflow: 'auto', background: 'var(--ant-color-bg-layout)' }}>
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
