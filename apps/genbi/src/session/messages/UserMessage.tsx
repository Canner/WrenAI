import { Typography } from 'antd';
import type { UserEvent } from '../types';

interface Props {
  event: UserEvent;
}

/** The user's turn: right-aligned, no chrome beyond a tinted bubble. */
export function UserMessage({ event }: Props) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <div
        style={{
          maxWidth: '80%',
          background: 'var(--ant-color-primary-bg)',
          borderRadius: 12,
          padding: '8px 12px',
        }}
      >
        <Typography.Text>{event.text}</Typography.Text>
      </div>
    </div>
  );
}
