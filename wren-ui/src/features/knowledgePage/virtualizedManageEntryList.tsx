import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from 'react';
import { ManageEntryList } from './index.styles';

type VirtualizedManageEntryListProps<TItem> = {
  items: TItem[];
  itemKey: (item: TItem) => string | number;
  renderItem: (item: TItem) => ReactNode;
};

const MANAGE_ENTRY_VIRTUALIZATION_THRESHOLD = 40;
const MANAGE_ENTRY_ITEM_ESTIMATED_HEIGHT = 66;
const MANAGE_ENTRY_VIRTUAL_OVERSCAN = 4;
const MANAGE_ENTRY_MAX_HEIGHT = 420;
const MANAGE_ENTRY_ITEMS_CONTAINER_STYLE = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 8,
};

function VirtualizedManageEntryListInner<TItem>({
  items,
  itemKey,
  renderItem,
}: VirtualizedManageEntryListProps<TItem>) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const shouldVirtualize =
    items.length >= MANAGE_ENTRY_VIRTUALIZATION_THRESHOLD;

  useEffect(() => {
    if (!shouldVirtualize) {
      setScrollTop(0);
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const measureViewport = () => {
      setViewportHeight(viewport.clientHeight);
    };

    measureViewport();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      measureViewport();
    });
    observer.observe(viewport);

    return () => {
      observer.disconnect();
    };
  }, [items.length, shouldVirtualize]);

  const virtualWindow = useMemo(() => {
    if (!shouldVirtualize) {
      return {
        startIndex: 0,
        endIndex: items.length,
        topSpacerHeight: 0,
        bottomSpacerHeight: 0,
      };
    }

    const effectiveViewportHeight = Math.max(
      viewportHeight,
      MANAGE_ENTRY_ITEM_ESTIMATED_HEIGHT,
    );
    const visibleCount = Math.max(
      1,
      Math.ceil(effectiveViewportHeight / MANAGE_ENTRY_ITEM_ESTIMATED_HEIGHT),
    );
    const startIndex = Math.max(
      0,
      Math.floor(scrollTop / MANAGE_ENTRY_ITEM_ESTIMATED_HEIGHT) -
        MANAGE_ENTRY_VIRTUAL_OVERSCAN,
    );
    const endIndex = Math.min(
      items.length,
      startIndex + visibleCount + MANAGE_ENTRY_VIRTUAL_OVERSCAN * 2,
    );

    return {
      startIndex,
      endIndex,
      topSpacerHeight: startIndex * MANAGE_ENTRY_ITEM_ESTIMATED_HEIGHT,
      bottomSpacerHeight:
        (items.length - endIndex) * MANAGE_ENTRY_ITEM_ESTIMATED_HEIGHT,
    };
  }, [items.length, scrollTop, shouldVirtualize, viewportHeight]);

  const renderedItems = useMemo(
    () => items.slice(virtualWindow.startIndex, virtualWindow.endIndex),
    [items, virtualWindow.endIndex, virtualWindow.startIndex],
  );

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (!shouldVirtualize) {
        return;
      }
      setScrollTop(event.currentTarget.scrollTop);
    },
    [shouldVirtualize],
  );

  return (
    <ManageEntryList
      ref={viewportRef}
      onScroll={handleScroll}
      style={{
        maxHeight: MANAGE_ENTRY_MAX_HEIGHT,
        overflowY: 'auto',
        gap: 0,
        scrollbarGutter: 'stable',
      }}
    >
      {shouldVirtualize && virtualWindow.topSpacerHeight > 0 ? (
        <div style={{ height: virtualWindow.topSpacerHeight }} aria-hidden />
      ) : null}
      <div style={MANAGE_ENTRY_ITEMS_CONTAINER_STYLE}>
        {renderedItems.map((item) => (
          <Fragment key={itemKey(item)}>{renderItem(item)}</Fragment>
        ))}
      </div>
      {shouldVirtualize && virtualWindow.bottomSpacerHeight > 0 ? (
        <div style={{ height: virtualWindow.bottomSpacerHeight }} aria-hidden />
      ) : null}
    </ManageEntryList>
  );
}

export const VirtualizedManageEntryList = memo(
  VirtualizedManageEntryListInner,
  (previous, next) =>
    previous.items === next.items &&
    previous.itemKey === next.itemKey &&
    previous.renderItem === next.renderItem,
) as typeof VirtualizedManageEntryListInner;
