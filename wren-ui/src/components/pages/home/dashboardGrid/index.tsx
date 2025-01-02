import React, { useMemo } from 'react';
import styled from 'styled-components';
import GridLayout from 'react-grid-layout';

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const StyledDashboardGrid = styled.div`
  width: 768px;
  margin-right: auto;
  margin-left: auto;
  background-color: var(--gray-3);
  border: 1px solid var(--gray-4);
  border-radius: 4px;

  .adm-pin-item {
    background-color: white;
    height: 100%;
    border-radius: 8px;
    border: 1px solid var(--gray-4);
    padding: 16px;
    box-shadow:
      rgba(0, 0, 0, 0.1) 0px 10px 15px -3px,
      rgba(0, 0, 0, 0.05) 0px 4px 6px -2px;
  }

  .react-grid-placeholder {
    background-color: var(--blue-6);
  }
`;

interface GridItem {
  id: string;
  layout: { x: number; y: number; w: number; h: number };
  render: React.ReactNode;
}

export default function DashboardGrid() {
  // TODO: integrate with backend
  const gridLayouts = useMemo(() => {
    return [
      {
        id: 'a',
        layout: { x: 0, y: 0, w: 6, h: 6 },
        render: <div className="adm-pin-item">a</div>,
      },
      {
        id: 'b',
        layout: { x: 6, y: 0, w: 6, h: 6 },
        render: <div className="adm-pin-item">b</div>,
      },
    ];
  }, []);

  const getGridItems = (grids: GridItem[]) =>
    grids.map((item) => {
      return (
        <div key={item.id} data-grid={item.layout}>
          {item.render}
        </div>
      );
    });

  return (
    <StyledDashboardGrid className="mt-12">
      <GridLayout
        className="layout"
        cols={12}
        margin={[16, 16]}
        rowHeight={30}
        width={768}
      >
        {getGridItems(gridLayouts)}
      </GridLayout>
    </StyledDashboardGrid>
  );
}
