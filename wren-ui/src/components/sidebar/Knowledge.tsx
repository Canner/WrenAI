import { useRouter } from 'next/router';
import clsx from 'clsx';
import FunctionOutlined from '@ant-design/icons/FunctionOutlined';
import { StyledTreeNodeLink } from './SidebarTree';
import { Path } from '@/utils/enum/path';
import { InstructionsSVG } from '@/utils/svgs';

export default function Knowledge() {
  const router = useRouter();

  return (
    <>
      <StyledTreeNodeLink
        className={clsx({
          'adm-treeNode--selected':
            router.pathname === Path.KnowledgeQuestionSQLPairs,
        })}
        href={Path.KnowledgeQuestionSQLPairs}
      >
        <FunctionOutlined className="mr-2" />
        <span className="text-medium">Question-SQL Pairs</span>
      </StyledTreeNodeLink>
      <StyledTreeNodeLink
        className={clsx({
          'adm-treeNode--selected':
            router.pathname === Path.KnowledgeInstructions,
        })}
        href={Path.KnowledgeInstructions}
      >
        <InstructionsSVG className="mr-2" />
        <span className="text-medium">Instructions</span>
      </StyledTreeNodeLink>
    </>
  );
}
