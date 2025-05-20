import { createCodeBlock, BaseProps } from './BaseCodeBlock';

const SQLCodeBlock = (props: BaseProps) => {
  const { ace } = window as any;
  const { SqlHighlightRules } = ace.require('ace/mode/sql_highlight_rules');
  const BaseCodeBlock = createCodeBlock(SqlHighlightRules);
  return <BaseCodeBlock {...props} />;
};

export default SQLCodeBlock;
