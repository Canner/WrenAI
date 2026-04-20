import {
  ChangeEvent,
  forwardRef,
  KeyboardEvent,
  ReactNode,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Input, Button, type GetRef } from 'antd';
import ArrowUpOutlined from '@ant-design/icons/ArrowUpOutlined';
import styled from 'styled-components';
import { attachLoading } from '@/utils/helper';

const InputShell = styled.div<{ $layout?: 'inline' | 'stacked' }>`
  min-width: 0;
  display: flex;
  flex: 1;
  align-items: ${(props) =>
    props.$layout === 'stacked' ? 'stretch' : 'flex-start'};
  flex-direction: ${(props) =>
    props.$layout === 'stacked' ? 'column' : 'row'};
  gap: 12px;

  .prompt-leading-icon {
    width: 20px;
    height: 20px;
    margin-top: 5px;
    color: #6b7386;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    flex-shrink: 0;
  }

  .ant-input {
    border: 0 !important;
    box-shadow: none !important;
    resize: none;
    padding: ${(props) => (props.$layout === 'stacked' ? '4px 0' : '2px 0')};
    font-size: ${(props) => (props.$layout === 'stacked' ? '15px' : '16px')};
    line-height: 1.7;
    background: transparent;
  }

  .ant-input::placeholder {
    color: #7d8496;
  }

  .ant-input[disabled] {
    background: transparent;
    color: rgba(15, 23, 42, 0.5);
  }
`;

const InlinePromptRow = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 12px;
  width: 100%;
`;

const PromptFooter = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
`;

const PromptFooterTools = styled.div`
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`;

const PromptButton = styled(Button)<{
  $iconOnly?: boolean;
  $stacked?: boolean;
}>`
  &.ant-btn {
    min-width: 32px;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 500;
    box-shadow: none;
    padding: 0;
    margin-bottom: ${(props) => (props.$stacked ? 0 : '4px')};
    background: var(--nova-primary);
  }

  &.ant-btn:disabled {
    background: #e5e7eb;
    color: #9ca3af;
  }
`;

interface Props {
  question: string;
  isProcessing: boolean;
  onAsk: (value: string) => Promise<void>;
  inputProps: {
    placeholder?: string;
  };
  leadingIcon?: ReactNode;
  buttonMode?: 'text' | 'icon';
  layout?: 'inline' | 'stacked';
  footerContent?: ReactNode;
  disabled?: boolean;
  onAtTrigger?: () => void;
}

export interface PromptInputHandle {
  focus: () => void;
}

export default forwardRef<PromptInputHandle, Props>(
  function PromptInput(props, ref) {
    const {
      onAsk,
      isProcessing,
      question,
      inputProps,
      leadingIcon,
      buttonMode = 'text',
      layout = 'inline',
      footerContent,
      disabled = false,
      onAtTrigger,
    } = props;
    const $promptInput = useRef<GetRef<typeof Input.TextArea>>(null);
    const [inputValue, setInputValue] = useState('');
    const [innerLoading, setInnerLoading] = useState(false);

    useEffect(() => {
      setInputValue(question || '');
    }, [question]);

    useEffect(() => {
      if (!isProcessing) {
        $promptInput.current?.focus();
        setInputValue('');
      }
    }, [isProcessing]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          $promptInput.current?.focus();
        },
      }),
      [],
    );

    const syncInputValue = (event: ChangeEvent<HTMLTextAreaElement>) => {
      setInputValue(event.target.value);
    };

    const handleAsk = () => {
      const trimmedValue = inputValue.trim();
      if (!trimmedValue || disabled) return;
      const startAsking = attachLoading(onAsk, setInnerLoading);
      startAsking(trimmedValue);
    };

    const isDisabled = innerLoading || isProcessing || disabled;

    const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === '@' && onAtTrigger && !isDisabled) {
        event.preventDefault();
        onAtTrigger();
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleAsk();
      }
    };

    const iconOnly = buttonMode === 'icon';

    const textArea = (
      <Input.TextArea
        ref={$promptInput}
        data-gramm="false"
        size="large"
        autoSize={{ minRows: 1, maxRows: 6 }}
        value={inputValue}
        onChange={syncInputValue}
        onKeyDown={handleInputKeyDown}
        disabled={isDisabled}
        {...inputProps}
      />
    );

    if (layout === 'stacked') {
      return (
        <InputShell $layout={layout}>
          {leadingIcon ? (
            <span className="prompt-leading-icon">{leadingIcon}</span>
          ) : null}
          {textArea}
          <PromptFooter>
            <PromptFooterTools>{footerContent}</PromptFooterTools>
            <PromptButton
              className="prompt-send-button"
              type="primary"
              onClick={handleAsk}
              disabled={isDisabled}
              $iconOnly={iconOnly}
              $stacked
              icon={iconOnly ? <ArrowUpOutlined /> : undefined}
              aria-label={iconOnly ? '发送问题' : undefined}
            >
              {iconOnly ? null : 'Ask'}
            </PromptButton>
          </PromptFooter>
        </InputShell>
      );
    }

    return (
      <InlinePromptRow>
        <InputShell $layout={layout}>
          {leadingIcon ? (
            <span className="prompt-leading-icon">{leadingIcon}</span>
          ) : null}
          {textArea}
        </InputShell>
        <PromptButton
          className="prompt-send-button"
          type="primary"
          onClick={handleAsk}
          disabled={isDisabled}
          $iconOnly={iconOnly}
          $stacked={false}
          icon={iconOnly ? <ArrowUpOutlined /> : undefined}
          aria-label={iconOnly ? '发送问题' : undefined}
        >
          {iconOnly ? null : 'Ask'}
        </PromptButton>
      </InlinePromptRow>
    );
  },
);
