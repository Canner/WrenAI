import { useState } from 'react';
import AceEditor from '@/components/editor/AceEditor';

interface Props {
  value?: string;
  onChange?: (value: string) => void;
  autoFocus?: boolean;
}

export default function SQLEditor(props: Props) {
  const { value, onChange, autoFocus } = props;

  const [sql, setSql] = useState(value || '');

  const change = (sql) => {
    setSql(sql);
    onChange && onChange(sql);
  };

  return (
    <AceEditor
      mode="sql"
      width="100%"
      height="300px"
      fontSize={14}
      theme="tomorrow"
      value={value || sql}
      onChange={change}
      name="sql_editor"
      editorProps={{ $blockScrolling: true }}
      enableLiveAutocompletion
      enableBasicAutocompletion
      showPrintMargin={false}
      focus={autoFocus}
    />
  );
}
