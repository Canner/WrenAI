import { Layout, Button, Tooltip, Space } from 'antd';
import { BulbOutlined, BulbFilled, MenuUnfoldOutlined, MenuFoldOutlined } from '@ant-design/icons';
import { NavLink } from 'react-router-dom';
import { useUiStore } from '@/stores/useUiStore';
import { t } from '@/i18n/strings';
import { pages } from '../registry';

/** Top bar: brand + primary nav tabs + sidebar/theme controls. */
export function TopBar() {
  const themeMode = useUiStore((s) => s.themeMode);
  const toggleThemeMode = useUiStore((s) => s.toggleThemeMode);
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const isDark = themeMode === 'dark';

  return (
    <Layout.Header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        paddingInline: 16,
        borderBottom: '1px solid var(--ant-color-border-secondary)',
        background: 'var(--ant-color-bg-container)',
      }}
    >
      <Tooltip placement="bottom" title={sidebarCollapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')}>
        <Button
          type="text"
          aria-label={sidebarCollapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')}
          icon={sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          onClick={toggleSidebar}
        />
      </Tooltip>

      <div style={{ display: 'flex', alignItems: 'center' }}>
        <img
          src={isDark ? '/wrenai_logo_white.png' : '/wrenai_logo.png'}
          alt={t('shell.appName')}
          height={24}
        />
      </div>

      <nav aria-label="Primary" style={{ flex: 1 }}>
        <Space size={4}>
          {pages.map((p) => (
            <NavLink
              key={p.key}
              to={p.path}
              style={({ isActive }) => ({
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 6,
                fontSize: 14,
                textDecoration: 'none',
                color: isActive ? 'var(--ant-color-primary)' : 'var(--ant-color-text)',
                background: isActive ? 'var(--ant-color-primary-bg)' : 'transparent',
              })}
            >
              <span aria-hidden="true" style={{ display: 'inline-flex' }}>
                {p.icon}
              </span>
              {p.label}
            </NavLink>
          ))}
        </Space>
      </nav>

      <Tooltip title={isDark ? t('shell.themeToLight') : t('shell.themeToDark')}>
        <Button
          type="text"
          aria-label={isDark ? t('shell.themeToLight') : t('shell.themeToDark')}
          icon={isDark ? <BulbFilled /> : <BulbOutlined />}
          onClick={toggleThemeMode}
        />
      </Tooltip>
    </Layout.Header>
  );
}
