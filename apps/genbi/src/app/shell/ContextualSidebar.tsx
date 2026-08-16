import { Layout } from 'antd';
import { useUiStore } from '@/stores/useUiStore';
import { useActivePage } from './useActivePage';

/**
 * Left contextual rail. Its content is supplied by the active page's `Sidebar`
 * provider from the registry, so it swaps per page (sessions / files / profiles
 * / runs / steps) without the shell knowing anything page-specific.
 */
export function ContextualSidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const active = useActivePage();
  const Sidebar = active?.Sidebar;

  return (
    <Layout.Sider
      data-testid="contextual-sidebar"
      collapsible
      collapsed={collapsed}
      collapsedWidth={0}
      trigger={null}
      width={248}
      theme="light"
      style={{
        background: 'var(--ant-color-bg-container)',
        borderRight: '1px solid var(--ant-color-border-secondary)',
        overflow: 'auto',
      }}
    >
      {Sidebar ? <Sidebar /> : null}
    </Layout.Sider>
  );
}
