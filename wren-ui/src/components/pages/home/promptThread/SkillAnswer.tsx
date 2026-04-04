import { useMemo } from 'react';
import { Alert, Table, Typography } from 'antd';
import styled from 'styled-components';
import MarkdownBlock from '@/components/editor/MarkdownBlock';
import Chart from '@/components/chart';

const SkillSection = styled.div`
  & + & {
    margin-top: 24px;
  }
`;

const SkillTableValue = styled.pre`
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
`;

const MAX_SKILL_ROWS = 50;
const SKILL_RESULT_TYPE = {
  TABULAR_FRAME: 'tabular_frame',
  METRIC_SERIES: 'metric_series',
  CHART_SPEC: 'chart_spec',
  ERROR: 'error',
} as const;

export type SkillResultPayload = {
  resultType?: string | null;
  rows?: Array<Record<string, any>>;
  columns?: Array<{
    name?: string | null;
    type?: string | null;
    description?: string | null;
  }>;
  series?: Array<Record<string, any>>;
  text?: string | null;
  chartSpec?: Record<string, any> | null;
  citations?: Array<{
    title?: string | null;
    url?: string | null;
    snippet?: string | null;
  }>;
};

const getSkillRows = (skillResult?: SkillResultPayload | null) => {
  if (Array.isArray(skillResult?.rows) && skillResult.rows.length > 0) {
    return skillResult.rows;
  }
  if (Array.isArray(skillResult?.series) && skillResult.series.length > 0) {
    return skillResult.series;
  }
  const embeddedValues = skillResult?.chartSpec?.data?.values;
  return Array.isArray(embeddedValues) ? embeddedValues : [];
};

const getSkillColumns = (
  skillResult?: SkillResultPayload | null,
  rows: Array<Record<string, any>> = [],
) => {
  const configuredColumns = Array.isArray(skillResult?.columns)
    ? skillResult.columns.filter((column) => !!column?.name)
    : [];
  if (configuredColumns.length > 0) {
    return configuredColumns.map((column) => ({
      key: column.name!,
      title: column.description || column.name!,
      dataIndex: column.name!,
    }));
  }

  const fieldNames = Array.from(
    new Set(rows.flatMap((row) => Object.keys(row))),
  );
  return fieldNames.map((fieldName) => ({
    key: fieldName,
    title: fieldName,
    dataIndex: fieldName,
  }));
};

const renderSkillValue = (value: any) => {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  if (typeof value === 'object') {
    return <SkillTableValue>{JSON.stringify(value, null, 2)}</SkillTableValue>;
  }

  return String(value);
};

export default function SkillAnswer({
  skillResult,
}: {
  skillResult?: SkillResultPayload | null;
}) {
  const { Text, Link } = Typography;
  const rows = useMemo(() => getSkillRows(skillResult), [skillResult]);
  const columns = useMemo(
    () => getSkillColumns(skillResult, rows),
    [skillResult, rows],
  );
  const dataSource = useMemo(
    () =>
      rows.slice(0, MAX_SKILL_ROWS).map((row, index) => ({
        __skillRowKey: `${index}`,
        ...row,
      })),
    [rows],
  );
  const chartSpec = skillResult?.chartSpec || null;
  const citations = Array.isArray(skillResult?.citations)
    ? skillResult.citations
    : [];
  const resultType = skillResult?.resultType;
  const hasTable =
    rows.length > 0 &&
    (resultType === SKILL_RESULT_TYPE.TABULAR_FRAME ||
      resultType === SKILL_RESULT_TYPE.METRIC_SERIES ||
      resultType === SKILL_RESULT_TYPE.CHART_SPEC);
  const hasChart = !!chartSpec && rows.length > 0;

  if (resultType === SKILL_RESULT_TYPE.ERROR) {
    return (
      <div className="py-4 px-6">
        <Alert
          message="Skill execution failed"
          description={
            skillResult?.text || 'The skill returned an error result.'
          }
          type="error"
          showIcon
        />
      </div>
    );
  }

  return (
    <div className="text-md gray-10 py-4 px-6">
      {skillResult?.text && (
        <SkillSection>
          <MarkdownBlock content={skillResult.text} />
        </SkillSection>
      )}

      {hasChart && (
        <SkillSection>
          <Chart
            hideActions
            spec={chartSpec as any}
            values={rows}
            width="100%"
            height={360}
          />
        </SkillSection>
      )}

      {chartSpec && !hasChart && (
        <SkillSection>
          <Alert
            message="Chart spec returned without row data"
            description="Displaying the raw chart specification instead."
            type="info"
            showIcon
          />
          <SkillTableValue className="mt-3">
            {JSON.stringify(chartSpec, null, 2)}
          </SkillTableValue>
        </SkillSection>
      )}

      {hasTable && (
        <SkillSection>
          <Table
            size="small"
            pagination={false}
            rowKey="__skillRowKey"
            scroll={{ x: 'max-content' }}
            dataSource={dataSource}
            columns={columns.map((column) => ({
              ...column,
              render: (_: any, record: Record<string, any>) =>
                renderSkillValue(record[column.dataIndex]),
            }))}
          />
          {rows.length > MAX_SKILL_ROWS && (
            <Text type="secondary" className="text-sm">
              Showing the first {MAX_SKILL_ROWS} rows of {rows.length}.
            </Text>
          )}
        </SkillSection>
      )}

      {citations.length > 0 && (
        <SkillSection>
          <Text strong>Sources</Text>
          <ul className="mt-2 mb-0 pl-5">
            {citations.map((citation, index) => (
              <li
                key={`${citation.url || citation.title || 'citation'}-${index}`}
              >
                {citation.url ? (
                  <Link
                    href={citation.url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {citation.title || citation.url}
                  </Link>
                ) : (
                  <span>{citation.title || 'Reference'}</span>
                )}
                {citation.snippet && (
                  <div className="gray-6 text-sm mt-1">{citation.snippet}</div>
                )}
              </li>
            ))}
          </ul>
        </SkillSection>
      )}

      {!skillResult?.text && !chartSpec && !hasTable && (
        <Alert
          message="Skill completed without displayable content"
          description="The skill returned successfully, but there is no text, chart, or table payload to render."
          type="info"
          showIcon
        />
      )}
    </div>
  );
}
