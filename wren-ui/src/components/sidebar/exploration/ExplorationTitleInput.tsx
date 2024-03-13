import { Input } from 'antd';

const ESCAPE = 'escape';

export default function ExplorationTitleInput(props: {
  title: string;
  onCancelChange: () => void;
  onSetTitle: (newTitle: string) => void;
  onRename: (newName: string) => void;
}) {
  const { title, onCancelChange, onRename, onSetTitle } = props;

  return (
    <Input
      autoFocus
      size="small"
      value={title}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e: React.KeyboardEvent) => {
        // change back to the original title
        if (e.key.toLowerCase() === ESCAPE) onCancelChange();
      }}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
        onSetTitle(e.target.value)
      }
      onPressEnter={(e) => onRename(title)}
      onBlur={(e) => onRename(title)}
    />
  );
}
