import type { ReactNode } from 'react';

interface KVRowProps {
  label: ReactNode;
  value: ReactNode;
}

/** A `label : value` row for status/detail panels. */
export function KVRow({ label, value }: KVRowProps) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 16,
        padding: '4px 0',
      }}
    >
      <span style={{ opacity: 0.65 }}>{label}</span>
      <span style={{ textAlign: 'right' }}>{value}</span>
    </div>
  );
}
