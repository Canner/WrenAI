import { useState } from 'react';
import { Typography } from 'antd';
import type { SidebarItem } from '@/fixtures';

interface SidebarListProps {
  header: string;
  items: SidebarItem[];
  emptyHint?: string;
  /** Controlled selection (e.g. driven by a route param). Falls back to internal state. */
  selectedKey?: string;
  /** Called when an item is clicked. If provided alongside `selectedKey`, the
   * caller owns selection (e.g. to navigate); otherwise selection is local-only. */
  onSelect?: (key: string) => void;
}

/**
 * Generic contextual-rail list (sessions / files / profiles / runs / steps).
 * By default selection is a local highlight only. Pass `selectedKey` +
 * `onSelect` to let a caller drive selection (e.g. Ask sessions, which
 * navigate to `/ask/:sessionId`) without changing any other page's behavior.
 */
export function SidebarList({ header, items, emptyHint, selectedKey, onSelect }: SidebarListProps) {
  const [localSelected, setLocalSelected] = useState<string | undefined>(items[0]?.key);
  const selected = selectedKey ?? localSelected;

  const handleSelect = (key: string) => {
    if (onSelect) {
      onSelect(key);
    } else {
      setLocalSelected(key);
    }
  };

  return (
    <nav aria-label={header} style={{ padding: '12px 8px' }}>
      <Typography.Text
        type="secondary"
        style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, padding: '0 8px' }}
      >
        {header}
      </Typography.Text>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.length === 0 && (
          <div style={{ padding: 8, opacity: 0.6, fontSize: 13 }}>{emptyHint ?? '—'}</div>
        )}
        {items.map((item) => {
          const isSelected = item.key === selected;
          return (
            <button
              key={item.key}
              type="button"
              aria-current={isSelected}
              aria-disabled={item.disabled}
              disabled={item.disabled}
              onClick={() => !item.disabled && handleSelect(item.key)}
              style={{
                textAlign: 'left',
                border: 'none',
                borderRadius: 6,
                padding: '6px 8px',
                cursor: item.disabled ? 'default' : 'pointer',
                background: isSelected ? 'var(--ant-color-fill-secondary)' : 'transparent',
                color: 'inherit',
                font: 'inherit',
                opacity: item.disabled ? 0.5 : 1,
              }}
            >
              <div style={{ fontSize: 13, lineHeight: 1.3 }}>{item.label}</div>
              {item.meta && (
                <div style={{ fontSize: 11, opacity: 0.6 }}>{item.meta}</div>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
