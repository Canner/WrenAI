import { forwardRef, useContext, useState } from 'react';
import styled from 'styled-components';
import { Collapse, Row, RowProps, Table, TableProps } from 'antd';
import {
  FormItemInputContext,
  FormItemStatusContextProps,
} from 'antd/lib/form/context';

const { Panel } = Collapse;

const StyledCollapse = styled(Collapse)`
  &.ant-collapse.adm-error {
    border-color: var(--red-5);
    border-bottom: 1px solid var(--red-5);
  }

  &.ant-collapse {
    background-color: white;
    border-color: var(--gray-4);

    > .ant-collapse-item > .ant-collapse-header {
      padding: 16px 12px;
      align-items: center;
    }

    > .ant-collapse-item,
    .ant-collapse-content {
      border-color: var(--gray-4);
    }

    .ant-collapse-content-box {
      padding: 0px;
    }

    .ant-table {
      border: none;

      .ant-table-thead > tr > th {
        color: var(--gray-7);
        background-color: white;
      }

      &.ant-table-empty {
        .ant-empty-normal {
          margin: 16px 0;
        }
      }
    }
  }
`;

const StyledRow = styled(Row).attrs<{
  $isRowSelection: boolean;
}>((props) => ({
  className: `${props.$isRowSelection ? '' : 'ml-1'}`,
}))`` as React.ForwardRefExoticComponent<
  RowProps & React.RefAttributes<HTMLDivElement> & { $isRowSelection: boolean }
>;

type Props<T> = TableProps<T> & {
  enableRowSelection?: boolean;
  extra?: (
    onCollapseOpen: (
      event: React.MouseEvent<HTMLElement, MouseEvent>,
      collapseKey: string,
    ) => void,
  ) => React.ReactNode;
  onChange?: (value: any | null) => void;
  rowKey: (record: T) => string;
  tableTitle: string;
  tableHeader: React.ReactNode;
};

function SelectionTable<T extends Record<string, any>>(
  props: Props<T>,
  ref: React.Ref<HTMLDivElement>,
) {
  const {
    columns,
    dataSource,
    extra,
    enableRowSelection,
    onChange,
    rowKey,
    tableHeader,
    tableTitle,
  } = props;

  const formItemContext =
    useContext<FormItemStatusContextProps>(FormItemInputContext);
  const { status } = formItemContext;

  const collapseState = useCollapseState(tableTitle);

  const isRowSelection = Boolean(enableRowSelection);

  const rowSelection: TableProps<T>['rowSelection'] = isRowSelection
    ? {
        type: 'checkbox',
        onChange: (_selectedRowKeys: React.Key[], selectedRows) => {
          onChange && onChange(selectedRows);
        },
      }
    : undefined;

  return (
    <StyledCollapse
      className={status ? `adm-${status}` : ''}
      defaultActiveKey={collapseState.collapseDefaultActiveKey}
      onChange={collapseState.onChangeCollapsePanelState}
    >
      <Panel
        extra={extra && extra(collapseState.onCollapseOpen)}
        header={
          <StyledRow
            wrap={false}
            gutter={8}
            align="middle"
            $isRowSelection={isRowSelection}
          >
            {tableHeader}
          </StyledRow>
        }
        key={tableTitle}
        showArrow={false}
      >
        <Table
          ref={ref}
          columns={columns}
          dataSource={dataSource}
          rowKey={rowKey}
          rowSelection={rowSelection}
          pagination={{ hideOnSinglePage: true, pageSize: 50, size: 'small' }}
        />
      </Panel>
    </StyledCollapse>
  );
}

export default forwardRef(SelectionTable);

function useCollapseState(tableTitleName: string) {
  const [collapseDefaultActiveKey, setCollapseDefaultActiveKey] = useState<
    string[]
  >([tableTitleName]);

  const onChangeCollapsePanelState = (key: string | string[]) =>
    setCollapseDefaultActiveKey(key as string[]);

  const onCollapseOpen = (
    event: React.MouseEvent<HTMLElement, MouseEvent>,
    collapseKey: string,
  ) => {
    // Make sure the panel is open
    onChangeCollapsePanelState([collapseKey]);
    if (collapseDefaultActiveKey.includes(collapseKey)) {
      event.stopPropagation();
    }
  };

  return {
    collapseDefaultActiveKey,
    onChangeCollapsePanelState,
    onCollapseOpen,
  };
}
