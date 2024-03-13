import { forwardRef, useEffect, useRef, useContext } from 'react';
import AceEditor from '@/components/editor/AceEditor';
import {
  FormItemInputContext,
  FormItemStatusContextProps,
} from 'antd/lib/form/context';

export interface SQLEditorAutoCompleteSourceWordInfo {
  // Show main string
  caption: string;
  // insert string into editor
  value: string;
  // Show hint type string
  meta: string;
}

interface Props {
  autoCompleteSource: SQLEditorAutoCompleteSourceWordInfo[];
  value?: string;
  onChange?: (value: any | null) => void;
}

function SQLEditor(props: Props, ref: any) {
  const { autoCompleteSource, value, onChange } = props;

  const editorRef = useRef<any>();

  const formItemContext =
    useContext<FormItemStatusContextProps>(FormItemInputContext);
  const { status } = formItemContext;

  useEffect(() => {
    const getCompletions = (editor, _session, _pos, _prefix, callback) => {
      const popup = editor.completer.popup;
      if (popup?.container) {
        popup.container.style.width = '50%';
        popup.resize();
      }

      callback(null, autoCompleteSource);
    };

    const { ace } = window as any;
    ace.require('ace/ext/language_tools').addCompleter({ getCompletions });

    return () => editorRef.current?.editor?.completers?.pop();
  }, [autoCompleteSource]);

  const onTriggerChange = (changedValue: any) => {
    onChange && onChange(changedValue);
  };

  return (
    <div ref={ref}>
      <AceEditor
        className={status ? `ace_editor-${status}` : ''}
        editorProps={{ $blockScrolling: true }}
        enableBasicAutocompletion
        enableLiveAutocompletion
        fontSize={14}
        height="300px"
        mode="sql"
        name="sql_editor"
        onChange={onTriggerChange}
        ref={editorRef}
        showPrintMargin={false}
        theme="tomorrow"
        width="100%"
        value={value}
      />
    </div>
  );
}

export default forwardRef(SQLEditor);
