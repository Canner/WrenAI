import { useEffect } from 'react';
import styled from 'styled-components';
import { Button, Typography } from 'antd';
import CheckOutlined from '@ant-design/icons/CheckOutlined';
import CopyOutlined from '@ant-design/icons/CopyOutlined';
import { Loading } from '@/components/PageLoading';
import '@/components/editor/AceEditor';

export interface BaseProps {
  code: string;
  copyable?: boolean;
  inline?: boolean;
  loading?: boolean;
  maxHeight?: string;
  showLineNumbers?: boolean;
  backgroundColor?: string;
}

const getBlockStyles = (props: {
  inline?: boolean;
  backgroundColor?: string;
}) => {
  if (props.inline) {
    return `
      display: inline;
      border: none;
      background: transparent !important;
      padding: 0;
      * { display: inline !important; }
    `;
  }
  return `
    background: ${props.backgroundColor || 'var(--gray-1)'} !important;
    padding: 8px;
  `;
};

export const Block = styled.div<{
  maxHeight?: string;
  inline?: boolean;
  backgroundColor?: string;
}>`
  position: relative;
  white-space: pre;
  font-size: 13px;
  border: 1px var(--gray-4) solid;
  border-radius: 4px;
  font-family: 'Source Code Pro', monospace;
  user-select: text;
  cursor: text;
  &:focus {
    outline: none;
  }
  ${getBlockStyles}

  .adm-code-wrap {
    ${(props) => (props.inline ? '' : 'overflow: auto;')}
    ${(props) => (props.maxHeight ? `max-height: ${props.maxHeight}px;` : ``)}
    user-select: text;
  }

  .adm-code-line {
    display: block;
    user-select: text;
    &-number {
      user-select: none;
      display: inline-block;
      min-width: 14px;
      text-align: right;
      margin-right: 1em;
      color: var(--gray-6);
      font-weight: 700;
      font-size: 12px;
    }
  }
`;

export const CopyText = styled(Typography.Text)`
  position: absolute;
  top: 0;
  right: 0;
  font-size: 0;
  button {
    background: var(--gray-1) !important;
  }

  .ant-typography-copy {
    font-size: 12px;
  }

  .ant-btn:not(:hover) {
    color: var(--gray-8);
  }
`;

export const addThemeStyleManually = (cssText: string) => {
  const id = 'ace-tomorrow';
  const themeElement = document.getElementById(id);
  if (!themeElement) {
    const styleElement = document.createElement('style');
    styleElement.id = id;
    document.head.appendChild(styleElement);
    styleElement.appendChild(document.createTextNode(cssText));
  }
};

export const createCodeBlock = (HighlightRules: any) => {
  return function CodeBlock(props: BaseProps) {
    const {
      code,
      copyable,
      maxHeight,
      inline,
      loading,
      showLineNumbers,
      backgroundColor,
    } = props;
    const { ace } = window as any;
    const { Tokenizer } = ace.require('ace/tokenizer');
    const rules = new HighlightRules();
    const tokenizer = new Tokenizer(rules.getRules());

    useEffect(() => {
      const { cssText } = ace.require('ace/theme/tomorrow');
      addThemeStyleManually(cssText);
    }, []);

    const lines = (code || '').split('\n').map((line, index) => {
      const tokens = tokenizer.getLineTokens(line).tokens;
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

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(
          e.currentTarget.querySelector('.adm-code-wrap') || e.currentTarget,
        );
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    };

    return (
      <Block
        className="ace_editor ace-tomorrow adm_code-block"
        maxHeight={maxHeight}
        inline={inline}
        backgroundColor={backgroundColor}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <Loading spinning={loading}>
          <div className="adm-code-wrap">
            {lines}
            {copyable && (
              <CopyText
                copyable={{
                  icon: [
                    <Button
                      key="copy-icon"
                      icon={<CopyOutlined />}
                      size="small"
                      style={{ backgroundColor: 'transparent' }}
                    />,
                    <Button
                      key="copied-icon"
                      icon={<CheckOutlined className="green-6" />}
                      size="small"
                    />,
                  ],
                  text: code,
                }}
              >
                {code}
              </CopyText>
            )}
          </div>
        </Loading>
      </Block>
    );
  };
};
