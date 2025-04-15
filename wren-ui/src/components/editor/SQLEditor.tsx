import clsx from 'clsx';
import { useState, useContext, useRef, useEffect } from 'react';
import styled from 'styled-components';
import AceEditor from '@/components/editor/AceEditor';
import { FormItemInputContext } from 'antd/lib/form/context';
import useAutoComplete from '@/hooks/useAutoComplete';

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

const Toolbar = styled.div`
  color: var(--gray-8);
  background-color: var(--gray-3);
  border-bottom: 1px solid var(--gray-5);
  height: 32px;
  padding: 4px 8px;
  border-radius: 4px 4px 0px 0px;
`;

interface Props {
  value?: string;
  onChange?: (value: string) => void;
  autoFocus?: boolean;
  autoComplete?: boolean;
  toolbar?: React.ReactNode;
}

const getLangTools = () => {
  const { ace } = window as any;
  return ace ? ace.require('ace/ext/language_tools') : null;
};

export default function SQLEditor(props: Props) {
  const { value, onChange, autoFocus, autoComplete, toolbar } = props;
  const $wrapper = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<boolean>(false);

  const formItemContext = useContext(FormItemInputContext);
  const { status } = formItemContext;

  const completers = useAutoComplete({
    includeColumns: true,
    skip: !autoComplete,
  });

  const resetCompleters = () => {
    // clear custom completer
    const langTools = getLangTools();
    langTools?.setCompleters([
      langTools.keyWordCompleter,
      langTools.snippetCompleter,
      langTools.textCompleter,
    ]);
  };

  useEffect(() => {
    resetCompleters();
    if (!autoComplete || completers.length === 0) return;

    const langTools = getLangTools();
    const customCompleter = {
      getCompletions: (_editor, _session, _pos, _prefix, callback) => {
        callback(null, completers);
      },
    };
    langTools?.addCompleter(customCompleter);

    return () => resetCompleters();
  }, [focused, autoComplete, completers]);

  const [sql, setSql] = useState(value || '');

  const change = (sql) => {
    setSql(sql);
    onChange?.(sql);
  };

  return (
    <Wrapper
      ref={$wrapper}
      className={clsx(
        'border border-gray-5 rounded overflow-hidden',
        status ? `adm-markdown-editor-${status}` : '',
        focused ? 'adm-markdown-editor-focused' : '',
      )}
      tabIndex={-1}
    >
      {!!toolbar && <Toolbar>{toolbar}</Toolbar>}
      <AceEditor
        mode="sql"
        width="100%"
        height="300px"
        fontSize={14}
        theme="tomorrow"
        value={value || sql}
        onChange={change}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        name="sql_editor"
        editorProps={{ $blockScrolling: true }}
        enableLiveAutocompletion
        enableBasicAutocompletion
        showPrintMargin={false}
        focus={autoFocus}
      />
    </Wrapper>
  );
}
