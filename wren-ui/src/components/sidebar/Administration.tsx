import Link from 'next/link';
import { useRouter } from 'next/router';
import styled from 'styled-components';
import TeamOutlined from '@ant-design/icons/TeamOutlined';
import IdcardOutlined from '@ant-design/icons/IdcardOutlined';
import SafetyCertificateOutlined from '@ant-design/icons/SafetyCertificateOutlined';
import { Path, MENU_KEY } from '@/utils/enum';
import SidebarMenu from '@/components/sidebar/SidebarMenu';

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

const MENU_KEY_MAP = {
  [Path.AdministrationUsers]: MENU_KEY.ADMIN_USERS,
  [Path.AdministrationRoles]: MENU_KEY.ADMIN_ROLES,
  [Path.AdministrationAssignments]: MENU_KEY.ADMIN_ASSIGNMENTS,
};

const linkStyle = { color: 'inherit', transition: 'none' };

export default function Administration() {
  const router = useRouter();

  const menuItems = [
    {
      label: (
        <Link style={linkStyle} href={Path.AdministrationUsers}>
          User Management
        </Link>
      ),
      icon: <TeamOutlined />,
      key: MENU_KEY.ADMIN_USERS,
      className: 'pl-4',
    },
    {
      label: (
        <Link style={linkStyle} href={Path.AdministrationRoles}>
          Role Management
        </Link>
      ),
      icon: <IdcardOutlined />,
      key: MENU_KEY.ADMIN_ROLES,
      className: 'pl-4',
    },
    {
      label: (
        <Link style={linkStyle} href={Path.AdministrationAssignments}>
          User Role Assignment
        </Link>
      ),
      icon: <SafetyCertificateOutlined />,
      key: MENU_KEY.ADMIN_ASSIGNMENTS,
      className: 'pl-4',
    },
  ];

  return (
    <Layout>
      <SidebarMenu
        items={menuItems}
        selectedKeys={[MENU_KEY_MAP[router.pathname]]}
      />
    </Layout>
  );
}
