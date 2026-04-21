import GridLayout, { Layout } from 'react-grid-layout';
import React, {
  createRef,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import styled from 'styled-components';

import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import type {
  DashboardGridItemData,
  DashboardItemLayoutInput,
} from '@/utils/dashboardRest';

import { DashboardGridPinnedItem } from './DashboardGridPinnedItem';
import type { DashboardGridPinnedItemHandle } from './dashboardGridTypes';
import {
  calculateDashboardGridColumnSize,
  DASHBOARD_GRID_COLUMN_COUNT,
  DASHBOARD_GRID_GUTTER,
  resolveDashboardGridLayouts,
  resolveDashboardGridWidth,
} from './dashboardGridLayout';

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const StyledDashboardGrid = styled.div`
  flex: 1;
  padding: 18px;
  min-width: 0;
  min-height: 0;

  .adm-dashboard-grid-viewport {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }

  .react-grid-layout {
    width: 100%;
    height: 100%;
    min-width: 0;
  }

  .adm-pinned-item {
    cursor: grab;
    background: linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.98) 0%,
      rgba(248, 246, 251, 0.98) 100%
    );
    height: 100%;
    border-radius: 22px;
    border: 1px solid var(--nova-outline-soft);
    box-shadow: 0 20px 40px -28px rgba(31, 35, 50, 0.28);
    transition:
      border-color 0.2s ease,
      transform 0.2s ease,
      box-shadow 0.2s ease;

    &:hover {
      border-color: var(--nova-primary);
      transform: translateY(-1px);
      box-shadow: 0 24px 44px -28px rgba(31, 35, 50, 0.32);
    }
  }

  .adm-pinned-item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 18px 16px 0 18px;

    * {
      min-width: 0;
    }
  }

  .adm-pinned-item-title {
    font-size: 14px;
    font-weight: 700;
    flex-grow: 1;
  }

  .adm-pinned-actions {
    display: flex;
    gap: 4px;
    align-items: center;
    flex-shrink: 0;
  }

  .adm-pinned-content {
    height: calc(100% - 40px);
    padding: 16px 16px 18px;

    &-overflow {
      overflow: auto;
      height: calc(100% - 18px);
      padding: 8px 12px;
    }

    &-info {
      font-size: 12px;
      color: var(--gray-6);
      text-align: right;
      user-select: none;
    }
  }

  .adm-pinned-item-chart {
    height: 100%;
  }

  .react-grid-placeholder {
    background-color: rgba(141, 101, 225, 0.22);
    border-radius: 20px;
  }
`;

export type DashboardGridItem = DashboardGridItemData;

const getLayoutToUpdateItem = (layout: Layout) => ({
  itemId: Number(layout.i),
  x: layout.x,
  y: layout.y,
  w: layout.w,
  h: layout.h,
});

interface Props {
  items: DashboardGridItem[];
  isSupportCached: boolean;
  readOnly?: boolean;
  runtimeScopeSelector: ClientRuntimeScopeSelector;
  onUpdateChange: (layouts: DashboardItemLayoutInput[]) => void;
  onDelete: (id: number) => Promise<void>;
  onItemUpdated: (item: DashboardGridItem) => void;
  onNavigateToThread: (
    threadId?: number | null,
    responseId?: number | null,
  ) => Promise<void>;
}

export interface DashboardGridHandle {
  onRefreshAll: () => void;
  focusItem: (id: number) => void;
}

const DashboardGrid = forwardRef(
  (props: Props, ref: React.Ref<DashboardGridHandle>) => {
    const {
      items,
      isSupportCached,
      readOnly = false,
      runtimeScopeSelector,
      onUpdateChange,
      onDelete,
      onItemUpdated,
      onNavigateToThread,
    } = props;
    const itemRefs = useRef<
      Record<number, React.RefObject<DashboardGridPinnedItemHandle>>
    >({});
    const itemNodes = useRef<Record<string, HTMLDivElement | null>>({});
    const containerRef = useRef<HTMLDivElement>(null);
    const [gridWidth, setGridWidth] = useState(1200);

    useEffect(() => {
      items.forEach((item) => {
        itemRefs.current[item.id] = createRef<DashboardGridPinnedItemHandle>();
      });
    }, [items]);

    useImperativeHandle(
      ref,
      () => ({
        onRefreshAll: () => {
          Object.values(itemRefs.current).forEach((itemRef) => {
            itemRef.current?.onRefresh();
          });
        },
        focusItem: (id: number) => {
          const node = itemNodes.current[String(id)];
          if (!node) {
            return;
          }

          node.scrollIntoView({
            behavior: 'smooth',
            block: 'start',
            inline: 'nearest',
          });

          const itemElement = node.querySelector(
            '.adm-pinned-item',
          ) as HTMLElement | null;
          if (itemElement) {
            itemElement.style.borderColor = 'var(--nova-primary)';
            window.setTimeout(() => {
              itemElement.style.borderColor = '';
            }, 1400);
          }
        },
      }),
      [items],
    );

    const layouts = useMemo(() => resolveDashboardGridLayouts(items), [items]);

    const gridItems = items.map((item) => (
      <div
        key={item.id}
        ref={(node) => {
          itemNodes.current[String(item.id)] = node;
        }}
        data-dashboard-item-id={item.id}
      >
        <DashboardGridPinnedItem
          ref={itemRefs.current[item.id]}
          isSupportCached={isSupportCached}
          readOnly={readOnly}
          runtimeScopeSelector={runtimeScopeSelector}
          item={item}
          onDelete={onDelete}
          onItemUpdated={onItemUpdated}
          onNavigateToThread={onNavigateToThread}
        />
      </div>
    ));

    useEffect(() => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const renderGridWidth = () => {
        const measuredWidth = resolveDashboardGridWidth(container.clientWidth);
        if (measuredWidth === 0) {
          return;
        }
        setGridWidth(measuredWidth);
      };

      renderGridWidth();
      const resizeObserver =
        typeof ResizeObserver !== 'undefined'
          ? new ResizeObserver(() => renderGridWidth())
          : null;
      resizeObserver?.observe(container);
      window.addEventListener('resize', renderGridWidth);
      return () => {
        resizeObserver?.disconnect();
        window.removeEventListener('resize', renderGridWidth);
      };
    }, []);

    return (
      <StyledDashboardGrid>
        <div ref={containerRef} className="adm-dashboard-grid-viewport">
          <GridLayout
            layout={layouts}
            cols={DASHBOARD_GRID_COLUMN_COUNT}
            margin={[DASHBOARD_GRID_GUTTER, DASHBOARD_GRID_GUTTER]}
            containerPadding={[0, 0]}
            rowHeight={calculateDashboardGridColumnSize(gridWidth)}
            width={gridWidth}
            isDraggable={!readOnly}
            isResizable={!readOnly}
            onLayoutChange={(nextLayouts: Layout[]) => {
              if (readOnly) {
                return;
              }
              onUpdateChange(
                nextLayouts.map((layout) => getLayoutToUpdateItem(layout)),
              );
            }}
          >
            {gridItems}
          </GridLayout>
        </div>
      </StyledDashboardGrid>
    );
  },
);

export default DashboardGrid;
