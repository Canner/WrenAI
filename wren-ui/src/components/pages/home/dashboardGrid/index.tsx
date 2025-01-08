import dynamic from 'next/dynamic';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from 'antd';
import styled from 'styled-components';
import GridLayout, { Layout } from 'react-grid-layout';
import { MoreIcon } from '@/utils/icons';
import { MORE_ACTION } from '@/utils/enum';
import { nextTick } from '@/utils/time';
import { LoadingWrapper } from '@/components/PageLoading';
import { DashboardItemDropdown } from '@/components/diagram/CustomDropdown';
import {
  DashboardItem,
  ItemLayoutInput,
} from '@/apollo/client/graphql/__types__';
import { usePreviewItemSqlMutation } from '@/apollo/client/graphql/dashboard.generated';

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const Chart = dynamic(() => import('@/components/chart'), {
  ssr: false,
});

const StyledDashboardGrid = styled.div`
  flex: 1;
  padding: 16px;

  .react-grid-layout {
    width: 100%;
    height: 100%;
  }

  .adm-pinned-item {
    cursor: grab;
    background-color: white;
    height: 100%;
    border-radius: 4px;
    border: 2px solid transparent;
    box-shadow: rgba(45, 62, 80, 0.12) 0px 1px 5px 0px;
    transition: border-color 0.2s ease;

    &:hover {
      border-color: var(--geekblue-6);
    }
  }

  .adm-pinned-item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 8px 0 16px;
  }

  .adm-pinned-item-title {
    font-size: 14px;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .adm-pinned-actions {
    display: flex;
    gap: 4px;
    align-items: center;
  }

  .adm-pinned-content {
    height: calc(100% - 40px);
    padding: 16px 12px 16px;

    &-overflow {
      overflow: auto;
      height: 100%;
      padding: 8px 12px;
    }
  }

  .adm-pinned-item-chart {
    height: 100%;
  }

  .react-grid-placeholder {
    background-color: var(--blue-6);
  }
`;

const GUTTER = 8;
const COLUMN_COUNT = 6;

const calculateLayoutWidth = (itemWidth: number) => {
  return itemWidth * COLUMN_COUNT + GUTTER * COLUMN_COUNT;
};

const calculateColumnSize = (containerWidth: number) => {
  return (containerWidth - GUTTER * COLUMN_COUNT) / COLUMN_COUNT;
};

const getLayoutToGrid = (item: DashboardItem) => {
  return {
    i: item.id.toString(),
    x: item.layout.x,
    y: item.layout.y,
    w: item.layout.w,
    h: item.layout.h,
  };
};

const getLayoutToUpdateItem = (layout: Layout) => {
  return {
    itemId: Number(layout.i),
    x: layout.x,
    y: layout.y,
    w: layout.w,
    h: layout.h,
  };
};

interface Props {
  items: DashboardItem[];
  onUpdateChange: (layouts: ItemLayoutInput[]) => void;
  onDelete: (id: number) => Promise<void>;
}

export default function DashboardGrid(props: Props) {
  const { items, onUpdateChange, onDelete } = props;
  const $container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(250);

  const layouts = useMemo(() => {
    return items.map((item) => getLayoutToGrid(item));
  }, [items]);

  const getGridItemLayouts = () =>
    items.map((item) => {
      return (
        <div key={item.id}>
          <PinnedItem item={item} onDelete={onDelete} />
        </div>
      );
    });

  useEffect(() => {
    const renderColumnSize = () => {
      if (!$container.current) return;
      const sidebarWidth = 280;
      const padding = 16 * 2;
      const containerWidth = window.innerWidth - sidebarWidth - padding;

      const minContainerWidth = 1024;
      let calculatedWidth = containerWidth;
      if (containerWidth <= minContainerWidth) {
        calculatedWidth = minContainerWidth;
        $container.current.style.minWidth = `${minContainerWidth + padding}px`;
      } else {
        $container.current.style.minWidth = '100%';
      }

      const columnSize = calculateColumnSize(calculatedWidth);
      setSize(columnSize);
    };
    renderColumnSize();
    window.addEventListener('resize', renderColumnSize);
    return () => {
      window.removeEventListener('resize', renderColumnSize);
    };
  }, [$container]);

  const onLayoutChange = (layouts: Layout[]) => {
    onUpdateChange(layouts.map((layout) => getLayoutToUpdateItem(layout)));
  };

  return (
    <StyledDashboardGrid ref={$container}>
      <GridLayout
        layout={layouts}
        cols={COLUMN_COUNT}
        margin={[GUTTER, GUTTER]}
        containerPadding={[0, 0]}
        rowHeight={size}
        width={calculateLayoutWidth(size)}
        onLayoutChange={onLayoutChange}
      >
        {getGridItemLayouts()}
      </GridLayout>
    </StyledDashboardGrid>
  );
}

export function PinnedItem(props: {
  item: DashboardItem;
  onDelete: (id: number) => Promise<void>;
}) {
  const { item, onDelete } = props;
  const { detail } = item;
  const [isHideLegend, setIsHideLegend] = useState(true);
  const [forceLoading, setForceLoading] = useState(false);
  const [forceUpdate, setForceUpdate] = useState(0);

  const [previewItemSQL, previewItemSQLResult] = usePreviewItemSqlMutation();

  useEffect(() => {
    previewItemSQL({ variables: { data: { itemId: item.id } } });
  }, [item.id]);

  useEffect(() => {
    setForceLoading(true);
    nextTick(200).then(() => {
      setForceUpdate((prev) => prev + 1);
      setForceLoading(false);
    });
  }, [item]);

  const title = useMemo(() => {
    return item.detail.chartSchema?.title || '';
  }, [item.detail.chartSchema?.title]);

  const onHideLegend = () => {
    setIsHideLegend(!isHideLegend);
    setForceUpdate((prev) => prev + 1);
  };

  const onMoreClick = async (action: MORE_ACTION) => {
    if (action === MORE_ACTION.DELETE) {
      await onDelete(item.id);
    } else if (action === MORE_ACTION.REFRESH) {
      previewItemSQL({ variables: { data: { itemId: item.id } } });
    } else if (action === MORE_ACTION.HIDE_CATEGORY) {
      onHideLegend();
    }
  };

  const loading = forceLoading || previewItemSQLResult.loading;

  return (
    <div className="adm-pinned-item">
      <div className="adm-pinned-item-header">
        <div className="adm-pinned-item-title" title={title}>
          {title}
        </div>
        <div className="adm-pinned-actions">
          <DashboardItemDropdown
            onMoreClick={onMoreClick}
            isHideLegend={isHideLegend}
          >
            <Button
              className="adm-pinned-more gray-8"
              type="text"
              size="small"
              icon={<MoreIcon />}
              onMouseDown={(e) => e.stopPropagation()}
            />
          </DashboardItemDropdown>
        </div>
      </div>
      <div className="adm-pinned-content">
        <div className="adm-pinned-content-overflow adm-scrollbar-track">
          <LoadingWrapper loading={loading} tip="Loading...">
            <Chart
              className="adm-pinned-item-chart"
              width="100%"
              height="100%"
              spec={detail.chartSchema}
              values={previewItemSQLResult.data?.previewItemSQL}
              forceUpdate={forceUpdate}
              autoFilter
              hideActions
              hideTitle
              hideLegend={isHideLegend}
            />
          </LoadingWrapper>
        </div>
      </div>
    </div>
  );
}
