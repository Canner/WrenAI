import { Button, Space, Typography } from 'antd';
import type { ClarifyEvent } from '../types';

interface Props {
  event: ClarifyEvent;
  onSelect: (chip: string) => void;
  /** Disable the chips once a later turn has started (they are no longer live). */
  disabled?: boolean;
}

export function ClarifyChips({ event, onSelect, disabled }: Props) {
  return (
    <div>
      <Typography.Paragraph style={{ marginBottom: 8 }}>{event.prompt}</Typography.Paragraph>
      <Space wrap>
        {event.chips.map((chip, i) => (
          <Button key={`${chip}-${i}`} size="small" disabled={disabled} onClick={() => onSelect(chip)}>
            {chip}
          </Button>
        ))}
      </Space>
    </div>
  );
}
