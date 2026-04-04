import Link from 'next/link';
import { useRouter } from 'next/router';
import styled from 'styled-components';
import CodeOutlined from '@ant-design/icons/CodeOutlined';
import ApiOutlined from '@ant-design/icons/ApiOutlined';
import FunctionOutlined from '@ant-design/icons/FunctionOutlined';
import { Path, MENU_KEY } from '@/utils/enum';
import { InstructionsSVG } from '@/utils/svgs';
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

const MENU_KEY_MAP = {
  [Path.KnowledgeConnectors]: MENU_KEY.CONNECTORS,
  [Path.KnowledgeSkills]: MENU_KEY.SKILLS,
  [Path.KnowledgeQuestionSQLPairs]: MENU_KEY.QUESTION_SQL_PAIRS,
  [Path.KnowledgeInstructions]: MENU_KEY.INSTRUCTIONS,
};

const linkStyle = { color: 'inherit', transition: 'none' };

export default function Knowledge() {
  const router = useRouter();
  const runtimeScopeNavigation = useRuntimeScopeNavigation();

  const menuItems = [
    {
      'data-guideid': 'connectors',
      label: (
        <Link
          style={linkStyle}
          href={runtimeScopeNavigation.href(Path.KnowledgeConnectors)}
        >
          Connectors
        </Link>
      ),
      icon: <ApiOutlined />,
      key: MENU_KEY.CONNECTORS,
      className: 'pl-4',
    },
    {
      'data-guideid': 'skills',
      label: (
        <Link
          style={linkStyle}
          href={runtimeScopeNavigation.href(Path.KnowledgeSkills)}
        >
          Skills
        </Link>
      ),
      icon: <CodeOutlined />,
      key: MENU_KEY.SKILLS,
      className: 'pl-4',
    },
    {
      'data-guideid': 'question-sql-pairs',
      label: (
        <Link
          style={linkStyle}
          href={runtimeScopeNavigation.href(Path.KnowledgeQuestionSQLPairs)}
        >
          Question-SQL pairs
        </Link>
      ),
      icon: <FunctionOutlined />,
      key: MENU_KEY.QUESTION_SQL_PAIRS,
      className: 'pl-4',
    },
    {
      'data-guideid': 'instructions',
      label: (
        <Link
          style={linkStyle}
          href={runtimeScopeNavigation.href(Path.KnowledgeInstructions)}
        >
          Instructions
        </Link>
      ),
      icon: <InstructionsSVG />,
      key: MENU_KEY.INSTRUCTIONS,
      className: 'pl-4',
    },
  ];

  return (
    <Layout>
      <SidebarMenu
        items={menuItems}
        selectedKeys={MENU_KEY_MAP[router.pathname]}
      />
    </Layout>
  );
}
