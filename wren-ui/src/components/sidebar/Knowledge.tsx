import Link from 'next/link';
import { useRouter } from 'next/router';
import styled from 'styled-components';
import BookOutlined from '@ant-design/icons/BookOutlined';
import { Path } from '@/utils/enum';
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

const KNOWLEDGE_MENU_KEY = 'knowledge-overview';

const linkStyle = { color: 'inherit', transition: 'none' };

export default function Knowledge() {
  const router = useRouter();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();

  const menuItems = [
    {
      'data-guideid': 'knowledge-overview',
      label: (
        <Link
          style={linkStyle}
          href={runtimeScopeNavigation.hrefWorkspace(Path.Knowledge)}
        >
          知识库
        </Link>
      ),
      icon: <BookOutlined />,
      key: KNOWLEDGE_MENU_KEY,
      className: 'pl-4',
    },
  ];

  return (
    <Layout>
      <SidebarMenu
        items={menuItems}
        selectedKeys={
          router.pathname.startsWith(Path.Knowledge) ? [KNOWLEDGE_MENU_KEY] : []
        }
      />
    </Layout>
  );
}
