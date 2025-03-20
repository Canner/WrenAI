import Link from 'next/link';
import { useRouter } from 'next/router';
import styled from 'styled-components';
import FunctionOutlined from '@ant-design/icons/FunctionOutlined';
import { Path, KNOWLEDGE } from '@/utils/enum';
import { InstructionsSVG } from '@/utils/svgs';
import SidebarMenu from '@/components/sidebar/SidebarMenu';
import { MENU_KEY_MAP } from '@/components/pages/knowledge/utils';

const Layout = styled.div`
  padding: 16px 0;
  position: absolute;
  z-index: 1;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  background-color: var(--gray-2);
  overflow: hidden;
`;

const linkStyle = { color: 'inherit', transition: 'none' };

export default function Knowledge() {
  const router = useRouter();

  const menuItems = [
    {
      'data-guideid': 'question-sql-pairs',
      label: (
        <Link style={linkStyle} href={Path.KnowledgeQuestionSQLPairs}>
          Question-SQL Pairs
        </Link>
      ),
      icon: <FunctionOutlined />,
      key: KNOWLEDGE.QUESTION_SQL_PAIRS,
      className: 'pl-4',
    },
    {
      'data-guideid': 'instructions',
      label: (
        <Link style={linkStyle} href={Path.KnowledgeInstructions}>
          Instructions
        </Link>
      ),
      icon: <InstructionsSVG />,
      key: KNOWLEDGE.INSTRUCTIONS,
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
