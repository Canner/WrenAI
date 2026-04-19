import Link from 'next/link';
import { useRouter } from 'next/router';
import styled from 'styled-components';
import { Path, MENU_KEY } from '@/utils/enum';
import { OpenInNewIcon } from '@/utils/icons';
import ApiOutlined from '@ant-design/icons/ApiOutlined';
import ReadOutlined from '@ant-design/icons/ReadOutlined';
import SidebarMenu from '@/components/sidebar/SidebarMenu';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';

const Layout = styled.div`
  padding: 16px 0;
  position: absolute;
  z-index: 1;
  left: 0;
  top: 0;
  width: 100%;
  background-color: var(--gray-2);
  overflow: hidden;
`;

const MENU_KEY_MAP: Record<string, MENU_KEY> = {
  [Path.APIManagementHistory]: MENU_KEY.API_HISTORY,
  [Path.SettingsDiagnostics]: MENU_KEY.API_HISTORY,
};

const linkStyle = { color: 'inherit', transition: 'none' };

export default function APIManagement() {
  const router = useRouter();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();

  const menuItems = [
    {
      'data-guideid': 'api-history',
      label: (
        <Link
          style={linkStyle}
          href={runtimeScopeNavigation.hrefWorkspace(Path.SettingsDiagnostics)}
        >
          API history
        </Link>
      ),
      icon: <ApiOutlined />,
      key: MENU_KEY.API_HISTORY,
      className: 'pl-4',
    },
    {
      label: (
        <Link
          className="gray-8 d-inline-flex align-center"
          href="https://wrenai.readme.io/reference/sql-generation"
          target="_blank"
          rel="noopener noreferrer"
        >
          API reference
          <OpenInNewIcon className="ml-1" />
        </Link>
      ),
      icon: <ReadOutlined />,
      key: MENU_KEY.API_REFERENCE,
      className: 'pl-4',
    },
  ];

  return (
    <Layout>
      <SidebarMenu
        items={menuItems}
        selectedKeys={
          MENU_KEY_MAP[router.pathname] ? [MENU_KEY_MAP[router.pathname]] : []
        }
      />
    </Layout>
  );
}
