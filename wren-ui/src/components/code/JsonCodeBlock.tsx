import { createCodeBlock, BaseProps } from './BaseCodeBlock';

const JsonCodeBlock = (props: BaseProps) => {
  const { code, ...rest } = props;
  const { ace } = window as any;
  let formattedJson;
  try {
    formattedJson =
      typeof code === 'string' ? code : JSON.stringify(code, null, 2);
  } catch {
    console.warn('Failed to format JSON', code);
    formattedJson = code;
  }

  const { JsonHighlightRules } = ace.require('ace/mode/json_highlight_rules');
  const BaseCodeBlock = createCodeBlock(JsonHighlightRules);
  return <BaseCodeBlock code={formattedJson} {...rest} />;
};

export default JsonCodeBlock;
