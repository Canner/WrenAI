import type { ReactNode } from 'react';
import { RobotOutlined } from '@ant-design/icons';

interface Props {
  children: ReactNode;
}

/** Shell for any agent-originated turn (clarify / answer / refusal / artifact / published). */
export function AgentMessage({ children }: Props) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 24,
          height: 24,
          borderRadius: '50%',
          marginTop: 2,
          flexShrink: 0,
          background: 'var(--ant-color-fill-secondary)',
          color: 'var(--ant-color-text-secondary)',
        }}
      >
        <RobotOutlined style={{ fontSize: 13 }} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}
