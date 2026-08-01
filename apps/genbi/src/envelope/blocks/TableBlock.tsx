import { useMemo } from 'react';
import { Empty } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DataTable } from '@/ui';
import { t } from '@/i18n/strings';
import type { TableBlock as TableBlockData, Cell } from '../types';

interface Props {
  block: TableBlockData;
}

type RowRecord = { key: number } & Record<string, Cell>;

/**
 * Renders a table block. Each row is either a positional array aligned to
 * `columns` by index (matching the reference renderer), or an object keyed by
 * column name (as some agent outputs emit). Both shapes are supported.
 * `columns`/`rows` are defended against absence: a live agent can emit a bare
 * `{ type: "table" }` (data only in the summary), which must render an empty
 * note, never crash.
 */
export function TableBlock({ block }: Props) {
  const blockColumns = block.columns ?? [];
  const blockRows = block.rows ?? [];

  const columns: ColumnsType<RowRecord> = useMemo(
    () =>
      blockColumns.map((name, i) => ({
        title: name,
        dataIndex: `c${i}`,
        key: `c${i}`,
      })),
    [blockColumns],
  );

  const data: RowRecord[] = useMemo(
    () =>
      blockRows.map((row, r) => {
        const record: RowRecord = { key: r };
        blockColumns.forEach((name, c) => {
          record[`c${c}`] = (Array.isArray(row) ? row[c] : row[name]) ?? null;
        });
        return record;
      }),
    [blockRows, blockColumns],
  );

  if (blockColumns.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('envelope.noTableData')} />;
  }

  return <DataTable<RowRecord> columns={columns} dataSource={data} />;
}
