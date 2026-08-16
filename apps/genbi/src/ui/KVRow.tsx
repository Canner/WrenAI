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
      {/* The label keeps its width; the value is the part that gives. */}
      <span style={{ opacity: 0.65, flexShrink: 0 }}>{label}</span>
      {/*
        `minWidth: 0` is what actually lets this shrink: a flex item's default
        `min-width: auto` floors it at its content width, so a long value —
        a connection location, a bundle hash — pushed straight out of its
        column and over whatever sat beside it. `overflowWrap` then breaks a
        long unbroken token rather than letting it overflow anyway.
      */}
      <span style={{ textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  );
}
