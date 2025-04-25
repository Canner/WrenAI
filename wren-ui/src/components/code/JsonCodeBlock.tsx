import { createCodeBlock, BaseProps } from './BaseCodeBlock';

const JsonCodeBlock = (props: BaseProps) => {
  const { code, ...rest } = props;
  const { ace } = window as any;
  const formattedJson =
    typeof code === 'string' ? code : JSON.stringify(code, null, 2);

  const { JsonHighlightRules } = ace.require('ace/mode/json_highlight_rules');
  const BaseCodeBlock = createCodeBlock(JsonHighlightRules);
  return <BaseCodeBlock code={formattedJson} {...rest} />;
};

export default JsonCodeBlock;
