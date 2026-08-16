import { Layout } from 'antd';
import { Outlet } from 'react-router-dom';
import { TopBar } from './TopBar';
import { ContextualSidebar } from './ContextualSidebar';
import { useActivePage } from './useActivePage';

/**
 * App shell: top bar + contextual sidebar + canvas. Pages render into the
 * canvas via <Outlet>; navigation is fully client-side (no full reload).
 */
export function AppShell() {
  const active = useActivePage();
  const isSessions = active?.key === 'sessions';
  return (
    <Layout style={{ height: '100vh' }}>
      <TopBar />
      <Layout>
        <ContextualSidebar />
        <Layout.Content data-testid="app-content" style={{ overflow: isSessions ? 'hidden' : 'auto', minHeight: 0, background: isSessions ? 'var(--ant-color-bg-container)' : 'var(--ant-color-bg-layout)' }}>
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
