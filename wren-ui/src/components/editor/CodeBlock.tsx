import React, { useEffect } from 'react';
import { Typography } from 'antd';
import styled from 'styled-components';
import '@/components/editor/AceEditor';
import { Loading } from '@/components/PageLoading';

const Block = styled.div<{ inline?: boolean; maxHeight?: string }>`
  position: relative;
  white-space: pre;
  font-size: 14px;
  border: 1px var(--gray-4) solid;
  border-radius: 4px;
  ${(props) =>
    props.inline
      ? `
      display: inline; border: none; background: transparent !important; padding: 0;
      * { display: inline !important; }
      `
      : `background: var(--gray-1); padding: 8px;`}

  .adm-code-wrap {
    position: relative;
    padding-bottom: 2px;
    ${(props) => (props.inline ? '' : 'overflow: auto;')}
    ${(props) => (props.maxHeight ? `max-height: ${props.maxHeight}px;` : ``)}
  }

  .adm-code-line {
    display: block;
    height: 22px;
    &-number {
      user-select: none;
      display: inline-block;
      min-width: 17px;
      text-align: right;
      margin-right: 1em;
      color: var(--gray-6);
      font-weight: 700;
      font-size: 14px;
    }
  }
`;

const CopyText = styled(Typography.Text)`
  position: absolute;
  top: 8px;
  right: 8px;
  font-size: 0;
  .ant-typography-copy {
    font-size: 12px;
  }
`;

interface Props {
  code: string;
  copyable?: boolean;
  inline?: boolean;
  loading?: boolean;
  maxHeight?: string;
  showLineNumbers?: boolean;
  highlightSlot?: React.ReactNode;
}

const addThemeStyleManually = (cssText) => {
  // same id as ace editor appended, it will exist only one.
  const id = 'ace-tomorrow';
  const themeElement = document.getElementById(id);
  if (!themeElement) {
    const styleElement = document.createElement('style');
    styleElement.id = id;
    document.head.appendChild(styleElement);
    styleElement.appendChild(document.createTextNode(cssText));
  }
};

export const getTokenizer = () => {
  const { ace } = window as any;
  const { Tokenizer } = ace.require('ace/tokenizer');
  const { SqlHighlightRules } = ace.require(`ace/mode/sql_highlight_rules`);
  const rules = new SqlHighlightRules();
  const tokenizer = new Tokenizer(rules.getRules());
  return (line) => {
    return tokenizer.getLineTokens(line).tokens;
  };
};

export default function CodeBlock(props: Props) {
  const {
    code,
    copyable,
    maxHeight,
    inline,
    loading,
    showLineNumbers,
    highlightSlot,
  } = props;

  useEffect(() => {
    const { ace } = window as any;
    const { cssText } = ace.require('ace/theme/tomorrow');
    addThemeStyleManually(cssText);
  }, []);

  const tokenize = getTokenizer();
  const lines = (code || '').split('\n').map((line, index) => {
    const tokens = tokenize(line);
    const children = tokens.map((token, index) => {
      const classNames = token.type.split('.').map((name) => `ace_${name}`);
      return (
        <span key={index} className={classNames.join(' ')}>
          {token.value}
        </span>
      );
    });
    return (
      <span className="adm-code-line ace_line" key={`${line}-${index}`}>
        {showLineNumbers && (
          <span className="adm-code-line-number">{index + 1}</span>
        )}
        {children}
      </span>
    );
  });

  return (
    <Block
      className="ace_editor ace-tomorrow adm_code-block"
      inline={inline}
      maxHeight={maxHeight}
    >
      <Loading spinning={loading}>
        <div className="adm-code-wrap">
          {lines}
          {highlightSlot}
          {copyable && <CopyText copyable>{code}</CopyText>}
        </div>
      </Loading>
    </Block>
  );
}
