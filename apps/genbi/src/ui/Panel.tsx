import type { ReactNode } from 'react';
import { Card } from 'antd';

interface PanelProps {
  title?: ReactNode;
  extra?: ReactNode;
  /** Muted helper line under the body. */
  note?: ReactNode;
  children?: ReactNode;
  bodyStyle?: React.CSSProperties;
  className?: string;
}

/** Site-wide panel skeleton (card + head + body + note), themed by AntD tokens. */
export function Panel({ title, extra, note, children, bodyStyle, className }: PanelProps) {
  return (
    <Card
      title={title}
      extra={extra}
      size="small"
      className={className}
      styles={{ body: bodyStyle }}
    >
      {children}
      {note != null && (
        <div style={{ marginTop: 8, opacity: 0.65, fontSize: 12 }}>{note}</div>
      )}
    </Card>
  );
}
