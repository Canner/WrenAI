import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Skeleton, Table, Typography } from 'antd';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import LoadingOutlined from '@ant-design/icons/LoadingOutlined';
import CaretDownOutlined from '@ant-design/icons/CaretDownOutlined';
import EditOutlined from '@ant-design/icons/EditOutlined';
import styled from 'styled-components';
import { BinocularsIcon } from '@/utils/icons';
import { nextTick } from '@/utils/time';
import { MORE_ACTION } from '@/utils/enum';
import usePromptThreadStore from './store';
import useDropdown from '@/hooks/useDropdown';
import useTextBasedAnswerStreamTask from '@/hooks/useTextBasedAnswerStreamTask';
import { Props as AnswerResultProps } from '@/components/pages/home/promptThread/AnswerResult';
import MarkdownBlock from '@/components/editor/MarkdownBlock';
import PreviewData from '@/components/dataPreview/PreviewData';
import { AdjustAnswerDropdown } from '@/components/diagram/CustomDropdown';
import Chart from '@/components/chart';
import { usePreviewDataMutation } from '@/apollo/client/graphql/home.generated';
import {
  AskingTaskType,
  ThreadResponseAnswerStatus,
} from '@/apollo/client/graphql/__types__';

const { Text } = Typography;

const StyledSkeleton = styled(Skeleton)`
  padding: 16px;
  .ant-skeleton-paragraph {
    margin-bottom: 0;
  }
`;

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

type SkillResultPayload = {
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

function SkillAnswer({
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

export const getAnswerIsFinished = (status: ThreadResponseAnswerStatus) =>
  [
    ThreadResponseAnswerStatus.FINISHED,
    ThreadResponseAnswerStatus.FAILED,
    ThreadResponseAnswerStatus.INTERRUPTED,
  ].includes(status);

const getIsLoadingFinished = (status: ThreadResponseAnswerStatus) =>
  getAnswerIsFinished(status) ||
  status === ThreadResponseAnswerStatus.STREAMING;

export default function TextBasedAnswer(props: AnswerResultProps) {
  const {
    onGenerateTextBasedAnswer,
    onOpenAdjustReasoningStepsModal,
    onOpenAdjustSQLModal,
  } = usePromptThreadStore();
  const { isLastThreadResponse, onInitPreviewDone, threadResponse } = props;
  const { id } = threadResponse;
  const { content, error, numRowsUsedInLLM, status } =
    threadResponse?.answerDetail || {};

  const [textAnswer, setTextAnswer] = useState<string>('');
  const adjustResultsDropdown = useDropdown();

  const [fetchAnswerStreamingTask, answerStreamTaskResult] =
    useTextBasedAnswerStreamTask();

  const answerStreamTask = answerStreamTaskResult.data;
  const skillResult =
    threadResponse.askingTask?.type === AskingTaskType.SKILL
      ? (threadResponse.askingTask?.skillResult as SkillResultPayload | null)
      : null;

  const isStreaming = useMemo(
    () => status === ThreadResponseAnswerStatus.STREAMING,
    [status],
  );

  // Adapt askingTask and adjustment reasoning data to dropdown
  const adjustAnswerDropdownData = useMemo(() => {
    const { payload } = threadResponse.adjustment || {};
    return {
      responseId: threadResponse.id,
      sql: threadResponse.sql,
      retrievedTables:
        threadResponse.askingTask?.retrievedTables ||
        payload?.retrievedTables ||
        [],
      sqlGenerationReasoning:
        threadResponse.askingTask?.sqlGenerationReasoning ||
        payload?.sqlGenerationReasoning ||
        '',
    };
  }, [
    threadResponse.id,
    threadResponse.sql,
    threadResponse.adjustment?.payload,
    threadResponse.askingTask?.retrievedTables,
    threadResponse.askingTask?.sqlGenerationReasoning,
  ]);

  useEffect(() => {
    if (isStreaming) {
      setTextAnswer(answerStreamTask);
    } else {
      setTextAnswer(content);
    }
  }, [answerStreamTask, isStreaming, content]);

  useEffect(() => {
    if (isStreaming) {
      fetchAnswerStreamingTask(id);
    }
  }, [isStreaming, id]);

  useEffect(() => {
    return () => {
      answerStreamTaskResult.onReset();
    };
  }, []);

  const rowsUsed = useMemo(
    () =>
      status === ThreadResponseAnswerStatus.FINISHED ? numRowsUsedInLLM : 0,
    [numRowsUsedInLLM, status],
  );

  const allowPreviewData = useMemo(() => Boolean(rowsUsed > 0), [rowsUsed]);

  const [previewData, previewDataResult] = usePreviewDataMutation({
    onError: (error) => console.error(error),
  });
  const hasPreviewData = !!previewDataResult.data?.previewData;

  const onPreviewData = async () => {
    await previewData({ variables: { where: { responseId: id } } });
  };

  const autoTriggerPreviewDataButton = async () => {
    await nextTick();
    await onPreviewData();
  };

  useEffect(() => {
    if (isLastThreadResponse) {
      if (allowPreviewData) {
        autoTriggerPreviewDataButton();
      }

      onInitPreviewDone();
    }
  }, [isLastThreadResponse, allowPreviewData]);

  const loading = !getIsLoadingFinished(status);

  const onRegenerateAnswer = () => {
    setTextAnswer('');
    onGenerateTextBasedAnswer(id);
  };

  const onMoreClick = async (payload: {
    type: MORE_ACTION;
    data: typeof adjustAnswerDropdownData;
  }) => {
    const { type, data } = payload;
    if (type === MORE_ACTION.ADJUST_STEPS) {
      onOpenAdjustReasoningStepsModal({
        responseId: data.responseId,
        retrievedTables: data.retrievedTables,
        sqlGenerationReasoning: data.sqlGenerationReasoning,
      });
    } else if (type === MORE_ACTION.ADJUST_SQL) {
      onOpenAdjustSQLModal({ responseId: id, sql: data.sql });
    }
  };

  const adjustAnswerDropdown = (
    <AdjustAnswerDropdown
      onMoreClick={onMoreClick}
      data={adjustAnswerDropdownData}
      onDropdownVisibleChange={adjustResultsDropdown.onVisibleChange}
    >
      <Button
        className="px-0"
        type="link"
        size="small"
        icon={<EditOutlined />}
        onClick={(event) => event.stopPropagation()}
      >
        Adjust the answer
        <CaretDownOutlined
          className="ml-1"
          rotate={adjustResultsDropdown.visible ? 180 : 0}
        />
      </Button>
    </AdjustAnswerDropdown>
  );

  if (error) {
    return (
      <>
        <div className="py-4 px-6">
          <div className="text-right">{adjustAnswerDropdown}</div>
          <Alert
            className="mt-4 mb-2"
            message={error.shortMessage}
            description={error.message}
            type="error"
            showIcon
          />
        </div>
      </>
    );
  }

  if (skillResult) {
    return <SkillAnswer skillResult={skillResult} />;
  }

  return (
    <StyledSkeleton
      active
      loading={loading}
      paragraph={{ rows: 4 }}
      title={false}
    >
      <div className="text-md gray-10 py-4 px-6">
        <div className="text-right mb-4">{adjustAnswerDropdown}</div>
        <MarkdownBlock content={textAnswer} />
        {isStreaming && <LoadingOutlined className="geekblue-6" spin />}
        {status === ThreadResponseAnswerStatus.INTERRUPTED && (
          <div className="mt-2 text-right">
            <Button
              icon={<ReloadOutlined />}
              size="small"
              type="link"
              title="Regenerate answer"
              onClick={onRegenerateAnswer}
            >
              Regenerate
            </Button>
          </div>
        )}
        {allowPreviewData ? (
          <div className="mt-6">
            <Button
              size="small"
              icon={
                <BinocularsIcon
                  style={{
                    paddingBottom: 2,
                    marginRight: 8,
                  }}
                />
              }
              loading={previewDataResult.loading}
              onClick={onPreviewData}
              data-ph-capture="true"
              data-ph-capture-attribute-name="cta_text-answer_preview_data"
            >
              View results
            </Button>

            <div className="mt-2 mb-3" data-guideid="text-answer-preview-data">
              {hasPreviewData && (
                <Text type="secondary" className="text-sm">
                  Considering the limit of the context window, we retrieve up to
                  500 rows of results to generate the answer.
                </Text>
              )}
              <PreviewData
                error={previewDataResult.error}
                loading={previewDataResult.loading}
                previewData={previewDataResult?.data?.previewData}
              />
            </div>
          </div>
        ) : (
          <>
            {!isStreaming && (
              <Alert
                message={
                  <>
                    Click <b>View SQL</b> to review the step-by-step query logic
                    and verify why the data is unavailable.
                  </>
                }
                type="info"
              />
            )}
          </>
        )}
      </div>
    </StyledSkeleton>
  );
}
