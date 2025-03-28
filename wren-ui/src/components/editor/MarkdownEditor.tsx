import clsx from 'clsx';
import { Button, Input } from 'antd';
import styled from 'styled-components';
import { useState, useContext } from 'react';
import ReadOutlined from '@ant-design/icons/ReadOutlined';
import EditOutlined from '@ant-design/icons/EditOutlined';
import { FormItemInputContext } from 'antd/lib/form/context';
import MarkdownBlock from './MarkdownBlock';

const Wrapper = styled.div`
  transition: all 0.3s cubic-bezier(0.645, 0.045, 0.355, 1);

  &:hover {
    border-color: var(--geekblue-5) !important;
  }

  &.adm-markdown-editor-error {
    border-color: var(--red-5) !important;

    .adm-markdown-editor-length {
      color: var(--red-5) !important;
    }
  }
  &:not(.adm-markdown-editor-error).adm-markdown-editor-focused {
    border-color: var(--geekblue-5) !important;
    box-shadow: 0 0 0 2px rgba(47, 84, 235, 0.2);
  }

  &.adm-markdown-editor-focused.adm-markdown-editor-error {
    borer-color: var(--red-4) !important;
    box-shadow: 0 0 0 2px rgba(255, 77, 79, 0.2);
  }
`;

const OverflowContainer = styled.div`
  overflow-y: auto;
  max-height: 400px;
`;

const LinkButton = styled(Button)`
  color: var(--gray-7);
`;

const StyledTextArea = styled(Input.TextArea)`
  border: none;
  border-radius: 0;
`;

interface Props {
  value?: string;
  onChange?: (value: string) => void;
  maxLength?: number;
  autoFocus?: boolean;
}

export default function MarkdownEditor(props: Props) {
  const { value, onChange, maxLength, autoFocus } = props;
  const [focused, setFocused] = useState<boolean>(false);
  const [isPreviewMode, setIsPreviewMode] = useState<boolean>(false);

  const formItemContext = useContext(FormItemInputContext);
  const { status } = formItemContext;

  const input = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const targetValue = e.target.value;
    onChange?.(targetValue);
  };

  const keydown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;

      // Set the value with a tab character or spaces
      const tabCharacter = '  '; // Use '\t' for a tab character or spaces for spaces
      const newValue =
        value?.slice(0, start) + tabCharacter + value?.slice(end);

      // Update the value and move the cursor
      onChange?.(newValue || '');
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd =
          start + tabCharacter.length;
      }, 0);
    }
  };

  return (
    <Wrapper
      className={clsx(
        'border border-gray-5 rounded overflow-hidden',
        status ? `adm-markdown-editor-${status}` : '',
        focused ? 'adm-markdown-editor-focused' : '',
      )}
      tabIndex={-1}
    >
      <div className="bg-gray-3 px-2 py-1 d-flex align-center justify-space-between">
        <div className="adm-markdown-editor-length gray-6 text-sm mr-2">
          {maxLength ? (
            <>
              {value?.length} / {maxLength} characters
            </>
          ) : (
            <>{value?.length} characters</>
          )}
        </div>
        <LinkButton
          icon={isPreviewMode ? <EditOutlined /> : <ReadOutlined />}
          type="link"
          size="small"
          onClick={() => setIsPreviewMode(!isPreviewMode)}
        >
          {isPreviewMode ? 'Edit mode' : 'Read mode'}
        </LinkButton>
      </div>
      <OverflowContainer className={clsx({ 'p-4': isPreviewMode })}>
        {isPreviewMode ? (
          <MarkdownBlock content={value} />
        ) : (
          <StyledTextArea
            className="p-4"
            rows={16}
            autoFocus={autoFocus}
            onInput={input}
            onKeyDown={keydown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            value={value}
            maxLength={maxLength}
          />
        )}
      </OverflowContainer>
    </Wrapper>
  );
}
