import {
  AskingTaskStatus,
  AskingTaskType,
  ChartTaskStatus,
  ChartType,
  type ThinkingStep,
  type ThinkingTrace,
  ThreadResponse,
  ThreadResponseAnswerStatus,
  type ThreadResponseChartDetail,
} from '@/types/home';
import type { PreparedTask } from './index';

export type PreparationTimelineStepStatus =
  | 'pending'
  | 'running'
  | 'finished'
  | 'failed';

export type PreparationTimelineStep = {
  key: string;
  title: string;
  description?: string | null;
  detailMarkdown?: string | null;
  status: PreparationTimelineStepStatus;
  tags?: string[];
};

export type PreparationTimelineModel =
  | {
      kind: 'ask';
      lifecycle: 'processing' | 'finished' | 'failed' | 'stopped';
      preparedTask: PreparedTask;
      steps: PreparationTimelineStep[];
      title: string;
      totalSteps: number;
    }
  | {
      chartDetail: ThreadResponseChartDetail;
      kind: 'chart';
      lifecycle: 'processing' | 'finished' | 'failed' | 'stopped';
      steps: PreparationTimelineStep[];
      title: string;
      totalSteps: number;
    };

const PREPARATION_TITLE = '思考步骤';

const formatChartType = (chartType?: ChartType | string | null) => {
  if (!chartType) {
    return null;
  }

  return (
    {
      AREA: '面积图',
      BAR: '柱状图',
      GROUPED_BAR: '分组柱状图',
      LINE: '折线图',
      MULTI_LINE: '多折线图',
      PIE: '饼图',
      STACKED_BAR: '堆叠柱状图',
    }[String(chartType).toUpperCase()] || String(chartType).toUpperCase()
  );
};

const buildStep = (step: PreparationTimelineStep): PreparationTimelineStep =>
  step;

const normalizePreparationStatus = (
  status: ThinkingStep['status'],
): PreparationTimelineStepStatus => (status === 'skipped' ? 'pending' : status);

const getMessageParamNumber = (
  step: ThinkingStep,
  key: string,
): number | null => {
  const value = step.messageParams?.[key];
  return typeof value === 'number' ? value : null;
};

const getMessageParamString = (
  step: ThinkingStep,
  key: string,
): string | null => {
  const value = step.messageParams?.[key];
  return typeof value === 'string' ? value : null;
};

const getMessageParamBoolean = (step: ThinkingStep, key: string): boolean =>
  step.messageParams?.[key] === true;

const toPreparationStepFromThinking = (
  step: ThinkingStep,
): PreparationTimelineStep => {
  const normalizedStatus = normalizePreparationStatus(step.status);
  const rows = getMessageParamNumber(step, 'rows');
  const count = getMessageParamNumber(step, 'count');
  const columns = getMessageParamNumber(step, 'columns');
  const chartType = formatChartType(getMessageParamString(step, 'chartType'));
  const canonicalizationVersion = getMessageParamString(
    step,
    'canonicalizationVersion',
  );
  const isCorrecting = getMessageParamBoolean(step, 'correcting');

  switch (step.key) {
    case 'ask.view_reused':
      return buildStep({
        key: step.key,
        title: '已命中可复用视图',
        description: '系统直接复用了现有视图结果',
        status: normalizedStatus,
      });
    case 'ask.sql_pairs_retrieved':
      return buildStep({
        key: step.key,
        title:
          normalizedStatus === 'running'
            ? '正在检索相关问答样例'
            : count && count > 0
              ? `已找到 ${count} 条相关问答样例`
              : '未找到相关问答样例',
        description:
          normalizedStatus === 'running'
            ? '系统正在尝试复用历史的 Question-SQL 样例'
            : null,
        status: normalizedStatus,
      });
    case 'ask.sql_instructions_retrieved':
      return buildStep({
        key: step.key,
        title:
          normalizedStatus === 'running'
            ? '正在检索 SQL 指令'
            : count && count > 0
              ? `已找到 ${count} 条 SQL 指令`
              : '未找到 SQL 指令',
        description:
          normalizedStatus === 'running'
            ? '系统正在加载与当前问题相关的 SQL 编写规则'
            : null,
        status: normalizedStatus,
      });
    case 'ask.sql_pair_reused':
      return buildStep({
        key: step.key,
        title: '已命中 SQL 模板',
        description: '系统直接复用了已有的问数模板结果',
        status: normalizedStatus,
      });
    case 'ask.sql_corrected':
      return buildStep({
        key: step.key,
        title: '已应用修正后的 SQL',
        description: '当前结果已切换为用户修正后的 SQL',
        status: normalizedStatus,
      });
    case 'ask.question_understood':
      return buildStep({
        key: step.key,
        title:
          normalizedStatus === 'running'
            ? '正在理解问题'
            : normalizedStatus === 'failed'
              ? '问题理解失败'
              : '已理解用户问题',
        status: normalizedStatus,
      });
    case 'ask.answer_reasoned':
      return buildStep({
        key: step.key,
        title:
          normalizedStatus === 'running'
            ? '正在组织回答思路'
            : normalizedStatus === 'failed'
              ? '回答思路组织失败'
              : '已组织回答思路',
        status: normalizedStatus,
        detailMarkdown: step.detail || null,
      });
    case 'ask.intent_recognized':
      return buildStep({
        key: step.key,
        title:
          normalizedStatus === 'running'
            ? '正在识别用户意图'
            : normalizedStatus === 'failed'
              ? '用户意图识别失败'
              : '已识别用户意图',
        description: '将继续生成 SQL 并整理答案',
        status: normalizedStatus,
      });
    case 'ask.candidate_models_selected':
      return buildStep({
        key: step.key,
        title:
          normalizedStatus === 'running'
            ? '正在匹配候选模型'
            : normalizedStatus === 'failed'
              ? '候选模型匹配失败'
              : `已匹配 ${count || 0} 个候选模型`,
        description: step.tags?.length
          ? '优先使用最相关的数据模型回答当前问题'
          : null,
        status: normalizedStatus,
        tags: step.tags || undefined,
      });
    case 'ask.sql_reasoned':
      return buildStep({
        key: step.key,
        title:
          normalizedStatus === 'running'
            ? '正在组织分析思路'
            : normalizedStatus === 'failed'
              ? '分析思路组织失败'
              : '已组织分析思路',
        status: normalizedStatus,
        detailMarkdown: step.detail || null,
      });
    case 'ask.sql_generated':
      return buildStep({
        key: step.key,
        title:
          normalizedStatus === 'running'
            ? isCorrecting
              ? '正在修正 SQL'
              : '正在生成 SQL'
            : normalizedStatus === 'failed'
              ? 'SQL 生成失败'
              : 'SQL 已生成',
        description:
          normalizedStatus === 'finished'
            ? '已生成用于回答当前问题的 SQL 语句'
            : null,
        status: normalizedStatus,
      });
    case 'ask.data_fetched':
      return buildStep({
        key: step.key,
        title:
          normalizedStatus === 'running'
            ? '正在获取结果数据'
            : normalizedStatus === 'failed'
              ? '结果数据获取失败'
              : rows && rows > 0
                ? `已获取 ${rows} 行结果数据`
                : '已获取结果数据',
        description:
          rows && rows > 0 ? `已使用 ${rows} 行结果数据参与回答整理` : null,
        status: normalizedStatus,
      });
    case 'ask.answer_instructions_retrieved':
      return buildStep({
        key: step.key,
        title:
          normalizedStatus === 'running'
            ? '正在检索回答指令'
            : count && count > 0
              ? `已加载 ${count} 条回答指令`
              : '未找到回答指令',
        description:
          normalizedStatus === 'running'
            ? '系统正在检查是否存在当前问题的回答整理规则'
            : null,
        status: normalizedStatus,
      });
    case 'ask.answer_generated':
      return buildStep({
        key: step.key,
        title:
          normalizedStatus === 'running'
            ? '正在整理回答'
            : normalizedStatus === 'failed'
              ? '回答生成失败'
              : '回答已生成',
        description:
          normalizedStatus === 'running'
            ? '正在将结果整理成自然语言答案'
            : null,
        status: normalizedStatus,
      });
    case 'chart.preview_data_fetched':
      return buildStep({
        key: step.key,
        title:
          normalizedStatus === 'running'
            ? '正在获取图表预览数据'
            : normalizedStatus === 'failed'
              ? '图表预览数据获取失败'
              : rows && rows > 0
                ? `已获取 ${rows} 行预览数据`
                : '已获取图表预览数据',
        description:
          normalizedStatus === 'finished' && rows && columns
            ? `已准备 ${rows} 行 × ${columns} 列的图表样本数据`
            : step.detail || null,
        status: normalizedStatus,
        tags: step.tags || undefined,
      });
    case 'chart.sql_pairs_retrieved':
      return buildStep({
        key: step.key,
        title:
          normalizedStatus === 'running'
            ? '正在回看相关问答样例'
            : count && count > 0
              ? `已回看 ${count} 条相关问答样例`
              : '未找到可复用的问答样例',
        description:
          normalizedStatus === 'running'
            ? '图表生成会继承原回答的问答上下文'
            : null,
        status: normalizedStatus,
      });
    case 'chart.sql_instructions_retrieved':
      return buildStep({
        key: step.key,
        title:
          normalizedStatus === 'running'
            ? '正在回看 SQL 指令'
            : count && count > 0
              ? `已回看 ${count} 条 SQL 指令`
              : '未找到可复用的 SQL 指令',
        description:
          normalizedStatus === 'running'
            ? '图表生成会继承原回答的 SQL 约束'
            : null,
        status: normalizedStatus,
      });
    case 'chart.intent_recognized':
      return buildStep({
        key: step.key,
        title:
          normalizedStatus === 'pending'
            ? '等待识别用户意图'
            : '已识别用户意图',
        description: '当前追问已被识别为图表生成请求',
        status: normalizedStatus,
      });
    case 'chart.chart_instructions_retrieved':
      return buildStep({
        key: step.key,
        title:
          normalizedStatus === 'running'
            ? '正在检索图表指令'
            : count && count > 0
              ? `已加载 ${count} 条图表指令`
              : '未找到图表指令',
        description:
          normalizedStatus === 'running'
            ? '系统正在检查是否存在图表生成的额外约束'
            : null,
        status: normalizedStatus,
      });
    case 'chart.chart_intent_detected':
      return buildStep({
        key: step.key,
        title:
          normalizedStatus === 'pending'
            ? '等待识别图表意图'
            : '已识别图表意图',
        description: '系统正在将当前追问解释为图表生成任务',
        status: normalizedStatus,
      });
    case 'chart.chartability_checked':
      return buildStep({
        key: step.key,
        title:
          normalizedStatus === 'running'
            ? '正在检查图表可行性'
            : normalizedStatus === 'failed'
              ? '图表可行性检查失败'
              : '已检查图表可行性',
        description: step.detail || null,
        status: normalizedStatus,
      });
    case 'chart.chart_type_selected':
      return buildStep({
        key: step.key,
        title:
          normalizedStatus === 'running'
            ? '正在选择图表类型'
            : normalizedStatus === 'failed'
              ? '图表类型选择失败'
              : chartType
                ? `已确定图表类型：${chartType}`
                : '已确定图表类型',
        description:
          normalizedStatus === 'running'
            ? '系统正在为当前数据选择更合适的可视化方式'
            : step.detail || null,
        status: normalizedStatus,
        detailMarkdown:
          normalizedStatus === 'finished' && step.detail ? step.detail : null,
      });
    case 'chart.chart_generated':
      return buildStep({
        key: step.key,
        title:
          normalizedStatus === 'running'
            ? '正在生成图表'
            : normalizedStatus === 'failed'
              ? '图表生成失败'
              : '图表已生成',
        description: step.detail || null,
        status: normalizedStatus,
      });
    case 'chart.chart_validated':
      return buildStep({
        key: step.key,
        title:
          normalizedStatus === 'running'
            ? '正在校验图表结果'
            : normalizedStatus === 'failed'
              ? '图表校验失败'
              : '图表已通过校验',
        description:
          normalizedStatus === 'finished'
            ? canonicalizationVersion
              ? `已通过 ${canonicalizationVersion} 校验`
              : '图表结构校验通过'
            : step.detail || null,
        status: normalizedStatus,
      });
    default:
      return buildStep({
        key: step.key,
        title: step.messageKey,
        description: step.detail || null,
        status: normalizedStatus,
        tags: step.tags || undefined,
      });
  }
};

const resolveStepsFromThinkingTrace = (
  thinking?: ThinkingTrace | null,
): PreparationTimelineStep[] =>
  thinking?.steps?.map(toPreparationStepFromThinking) || [];

const resolveAskLifecycle = ({
  answerStatus,
  preparedTask,
}: {
  answerStatus?: ThreadResponseAnswerStatus | null;
  preparedTask: PreparedTask;
}): PreparationTimelineModel['lifecycle'] => {
  if (preparedTask.status === AskingTaskStatus.STOPPED) {
    return 'stopped';
  }

  if (
    answerStatus === ThreadResponseAnswerStatus.FAILED ||
    answerStatus === ThreadResponseAnswerStatus.INTERRUPTED ||
    preparedTask.status === AskingTaskStatus.FAILED
  ) {
    return 'failed';
  }

  if (answerStatus === ThreadResponseAnswerStatus.FINISHED) {
    return 'finished';
  }

  return 'processing';
};

const resolveGenericAskSteps = ({
  askingStreamTask,
  preparedTask,
}: {
  askingStreamTask?: string;
  preparedTask: PreparedTask;
}): PreparationTimelineStep[] => {
  const reasoning =
    preparedTask.sqlGenerationReasoning || askingStreamTask || '';
  const status = preparedTask.status;

  const understandingStatus: PreparationTimelineStepStatus =
    status === AskingTaskStatus.UNDERSTANDING
      ? 'running'
      : status === AskingTaskStatus.FAILED && !reasoning
        ? 'failed'
        : [
              AskingTaskStatus.SEARCHING,
              AskingTaskStatus.PLANNING,
              AskingTaskStatus.GENERATING,
              AskingTaskStatus.CORRECTING,
              AskingTaskStatus.FINISHED,
              AskingTaskStatus.STOPPED,
            ].includes(status)
          ? 'finished'
          : 'pending';

  const reasoningStatus: PreparationTimelineStepStatus =
    status === AskingTaskStatus.PLANNING
      ? 'running'
      : [
            AskingTaskStatus.GENERATING,
            AskingTaskStatus.CORRECTING,
            AskingTaskStatus.FINISHED,
            AskingTaskStatus.STOPPED,
          ].includes(status)
        ? 'finished'
        : status === AskingTaskStatus.FAILED && Boolean(reasoning)
          ? 'failed'
          : understandingStatus === 'finished'
            ? 'pending'
            : 'pending';

  const generateStatus: PreparationTimelineStepStatus = [
    AskingTaskStatus.GENERATING,
    AskingTaskStatus.CORRECTING,
  ].includes(status)
    ? 'running'
    : [AskingTaskStatus.FINISHED, AskingTaskStatus.STOPPED].includes(status)
      ? 'finished'
      : status === AskingTaskStatus.FAILED
        ? 'failed'
        : reasoningStatus === 'finished'
          ? 'pending'
          : 'pending';

  return [
    buildStep({
      key: 'understanding',
      title:
        understandingStatus === 'running'
          ? '正在理解问题'
          : understandingStatus === 'failed'
            ? '问题理解失败'
            : '已理解用户问题',
      status: understandingStatus,
    }),
    buildStep({
      key: 'reasoning',
      title:
        reasoningStatus === 'running'
          ? '正在组织回答思路'
          : reasoningStatus === 'failed'
            ? '回答思路组织失败'
            : '已组织回答思路',
      status: reasoningStatus,
      detailMarkdown: reasoning || null,
    }),
    buildStep({
      key: 'generate',
      title:
        generateStatus === 'running'
          ? '正在生成回答'
          : generateStatus === 'failed'
            ? '回答生成失败'
            : '回答已生成',
      status: generateStatus,
    }),
  ];
};

const resolveAskDetailedSteps = ({
  askingStreamTask,
  data,
  preparedTask,
}: {
  askingStreamTask?: string;
  data: ThreadResponse;
  preparedTask: PreparedTask;
}): PreparationTimelineStep[] => {
  const answerStatus = data.answerDetail?.status || null;
  const answerRows = data.answerDetail?.numRowsUsedInLLM || 0;
  const reasoning =
    preparedTask.sqlGenerationReasoning || askingStreamTask || '';
  const tables = (preparedTask.retrievedTables || []).filter(Boolean);
  const isProcessingReasoning =
    preparedTask.status === AskingTaskStatus.PLANNING;
  const isProcessingSql = [
    AskingTaskStatus.GENERATING,
    AskingTaskStatus.CORRECTING,
  ].includes(preparedTask.status);
  const sqlFailed = preparedTask.status === AskingTaskStatus.FAILED;
  const answerFailed =
    answerStatus === ThreadResponseAnswerStatus.FAILED ||
    answerStatus === ThreadResponseAnswerStatus.INTERRUPTED;

  const intentStatus: PreparationTimelineStepStatus =
    preparedTask.status === AskingTaskStatus.UNDERSTANDING
      ? 'running'
      : sqlFailed && tables.length === 0 && !reasoning && !data.sql
        ? 'failed'
        : preparedTask.status
          ? 'finished'
          : 'pending';

  const modelStatus: PreparationTimelineStepStatus =
    preparedTask.status === AskingTaskStatus.SEARCHING
      ? 'running'
      : tables.length > 0
        ? 'finished'
        : sqlFailed && !reasoning && !data.sql
          ? 'failed'
          : [
                AskingTaskStatus.PLANNING,
                AskingTaskStatus.GENERATING,
                AskingTaskStatus.CORRECTING,
                AskingTaskStatus.FINISHED,
                AskingTaskStatus.STOPPED,
              ].includes(preparedTask.status)
            ? 'finished'
            : intentStatus === 'finished'
              ? 'pending'
              : 'pending';

  const reasoningStatus: PreparationTimelineStepStatus = isProcessingReasoning
    ? 'running'
    : reasoning
      ? 'finished'
      : sqlFailed
        ? 'failed'
        : [
              AskingTaskStatus.GENERATING,
              AskingTaskStatus.CORRECTING,
              AskingTaskStatus.FINISHED,
              AskingTaskStatus.STOPPED,
            ].includes(preparedTask.status)
          ? 'finished'
          : modelStatus === 'finished'
            ? 'pending'
            : 'pending';

  const sqlStatus: PreparationTimelineStepStatus = isProcessingSql
    ? 'running'
    : data.sql
      ? 'finished'
      : sqlFailed
        ? 'failed'
        : preparedTask.status === AskingTaskStatus.FINISHED
          ? 'finished'
          : reasoningStatus === 'finished'
            ? 'pending'
            : 'pending';

  const fetchingDataStatus: PreparationTimelineStepStatus = [
    ThreadResponseAnswerStatus.NOT_STARTED,
    ThreadResponseAnswerStatus.PREPROCESSING,
    ThreadResponseAnswerStatus.FETCHING_DATA,
  ].includes(answerStatus as ThreadResponseAnswerStatus)
    ? 'running'
    : [
          ThreadResponseAnswerStatus.STREAMING,
          ThreadResponseAnswerStatus.FINISHED,
        ].includes(answerStatus as ThreadResponseAnswerStatus)
      ? 'finished'
      : answerFailed
        ? 'failed'
        : sqlStatus === 'finished' && answerStatus
          ? 'pending'
          : 'pending';

  const answerStatusResolved: PreparationTimelineStepStatus =
    answerStatus === ThreadResponseAnswerStatus.STREAMING
      ? 'running'
      : answerStatus === ThreadResponseAnswerStatus.FINISHED
        ? 'finished'
        : answerFailed
          ? 'failed'
          : fetchingDataStatus === 'finished'
            ? 'pending'
            : 'pending';

  return [
    buildStep({
      key: 'intent',
      title:
        intentStatus === 'running'
          ? '正在识别用户意图'
          : intentStatus === 'failed'
            ? '用户意图识别失败'
            : '已识别用户意图',
      description:
        preparedTask.type === AskingTaskType.TEXT_TO_SQL
          ? '将继续生成 SQL 并整理答案'
          : null,
      status: intentStatus,
    }),
    buildStep({
      key: 'models',
      title:
        modelStatus === 'running'
          ? '正在匹配候选模型'
          : modelStatus === 'failed'
            ? '候选模型匹配失败'
            : `已匹配 ${tables.length || 0} 个候选模型`,
      description:
        tables.length > 0 ? `优先使用最相关的数据模型回答当前问题` : null,
      status: modelStatus,
      tags: tables.slice(0, 6),
    }),
    buildStep({
      key: 'reasoning',
      title:
        reasoningStatus === 'running'
          ? '正在组织分析思路'
          : reasoningStatus === 'failed'
            ? '分析思路组织失败'
            : '已组织分析思路',
      status: reasoningStatus,
      detailMarkdown: reasoning || null,
    }),
    buildStep({
      key: 'sql',
      title:
        sqlStatus === 'running'
          ? preparedTask.status === AskingTaskStatus.CORRECTING
            ? '正在修正 SQL'
            : '正在生成 SQL'
          : sqlStatus === 'failed'
            ? 'SQL 生成失败'
            : 'SQL 已生成',
      description:
        sqlStatus === 'finished' && data.sql
          ? '已生成用于回答当前问题的 SQL 语句'
          : null,
      status: sqlStatus,
    }),
    buildStep({
      key: 'data',
      title:
        fetchingDataStatus === 'running'
          ? '正在获取结果数据'
          : fetchingDataStatus === 'failed'
            ? '结果数据获取失败'
            : answerRows > 0
              ? `已获取 ${answerRows} 行结果数据`
              : '已获取结果数据',
      description:
        answerRows > 0 ? `已使用 ${answerRows} 行结果数据参与回答整理` : null,
      status: fetchingDataStatus,
    }),
    buildStep({
      key: 'answer',
      title:
        answerStatusResolved === 'running'
          ? '正在整理回答'
          : answerStatusResolved === 'failed'
            ? '回答生成失败'
            : '回答已生成',
      description:
        answerStatus === ThreadResponseAnswerStatus.STREAMING
          ? '正在将结果整理成自然语言答案'
          : null,
      status: answerStatusResolved,
    }),
  ];
};

const resolveAskSteps = ({
  askingStreamTask,
  data,
  preparedTask,
}: {
  askingStreamTask?: string;
  data: ThreadResponse;
  preparedTask: PreparedTask;
}): PreparationTimelineStep[] => {
  const thinkingSteps = resolveStepsFromThinkingTrace(preparedTask.thinking);
  if (thinkingSteps.length > 0) {
    return thinkingSteps;
  }

  if (data.view) {
    return [
      buildStep({
        key: 'view',
        title: '已命中可复用视图',
        description: '系统直接复用了现有视图结果',
        status: 'finished',
      }),
    ];
  }

  if (preparedTask?.candidates?.[0]?.sqlPair) {
    return [
      buildStep({
        key: 'sqlPair',
        title: '已命中 SQL 模板',
        description: '系统直接复用了已有的问数模板结果',
        status: 'finished',
      }),
    ];
  }

  if (data.sql && preparedTask?.invalidSql) {
    return [
      buildStep({
        key: 'fixedSql',
        title: '已应用修正后的 SQL',
        description: '当前结果已切换为用户修正后的 SQL',
        status: 'finished',
      }),
    ];
  }

  const usesSqlFlow =
    preparedTask.type === AskingTaskType.TEXT_TO_SQL ||
    Boolean(data.sql) ||
    (preparedTask.retrievedTables || []).length > 0;

  return usesSqlFlow
    ? resolveAskDetailedSteps({ askingStreamTask, data, preparedTask })
    : resolveGenericAskSteps({ askingStreamTask, preparedTask });
};

const resolveChartLifecycle = (
  chartStatus?: ChartTaskStatus | null,
): PreparationTimelineModel['lifecycle'] => {
  if (chartStatus === ChartTaskStatus.STOPPED) {
    return 'stopped';
  }
  if (chartStatus === ChartTaskStatus.FAILED) {
    return 'failed';
  }
  if (chartStatus === ChartTaskStatus.FINISHED) {
    return 'finished';
  }
  return 'processing';
};

const resolveChartSteps = (
  chartDetail: ThreadResponseChartDetail,
): PreparationTimelineStep[] => {
  const thinkingSteps = resolveStepsFromThinkingTrace(chartDetail.thinking);
  if (thinkingSteps.length > 0) {
    return thinkingSteps;
  }

  const diagnostics = chartDetail.diagnostics || null;
  const previewRows = diagnostics?.previewRowCount || 0;
  const previewColumns = diagnostics?.previewColumnCount || 0;
  const previewColumnNames =
    diagnostics?.previewColumns
      ?.map((column) => column?.name)
      .filter(Boolean) || [];
  const chartable = chartDetail.chartability?.chartable ?? true;
  const chartTypeLabel = formatChartType(chartDetail.chartType);
  const validationMessage =
    chartDetail.validationErrors?.[0] ||
    (chartDetail.error?.code === 'CHART_SCHEMA_INVALID'
      ? chartDetail.error.message
      : null);

  const previewStatus: PreparationTimelineStepStatus = diagnostics
    ? 'finished'
    : chartDetail.status === ChartTaskStatus.FAILED
      ? 'failed'
      : 'running';

  const intentStatus: PreparationTimelineStepStatus =
    previewStatus === 'finished' || previewStatus === 'failed'
      ? 'finished'
      : 'pending';

  const chartTypeStatus: PreparationTimelineStepStatus = chartTypeLabel
    ? 'finished'
    : chartable === false
      ? 'failed'
      : chartDetail.status === ChartTaskStatus.GENERATING
        ? 'running'
        : chartDetail.status === ChartTaskStatus.FAILED && chartable
          ? chartDetail.rawChartSchema || chartDetail.chartSchema
            ? 'finished'
            : 'pending'
          : diagnostics
            ? chartDetail.status === ChartTaskStatus.FETCHING
              ? 'running'
              : 'pending'
            : 'pending';

  const generationStatus: PreparationTimelineStepStatus =
    chartDetail.status === ChartTaskStatus.FINISHED
      ? 'finished'
      : chartable === false || previewStatus === 'failed'
        ? 'pending'
        : chartDetail.status === ChartTaskStatus.FAILED
          ? chartDetail.error?.code === 'CHART_SCHEMA_INVALID'
            ? 'finished'
            : chartTypeLabel ||
                chartDetail.rawChartSchema ||
                chartDetail.chartSchema
              ? 'failed'
              : 'pending'
          : [ChartTaskStatus.FETCHING, ChartTaskStatus.GENERATING].includes(
                chartDetail.status,
              )
            ? chartTypeStatus === 'finished'
              ? 'running'
              : 'pending'
            : 'pending';

  const validationStatus: PreparationTimelineStepStatus =
    chartDetail.status === ChartTaskStatus.FINISHED
      ? 'finished'
      : chartable === false || previewStatus === 'failed'
        ? 'pending'
        : chartDetail.status === ChartTaskStatus.FAILED
          ? chartDetail.error?.code === 'CHART_SCHEMA_INVALID' ||
            Boolean(chartDetail.validationErrors?.length)
            ? 'failed'
            : 'pending'
          : generationStatus === 'finished'
            ? 'running'
            : 'pending';

  return [
    buildStep({
      key: 'chart.sql_pairs_retrieved',
      title: '未找到可复用的问答样例',
      status: 'finished',
    }),
    buildStep({
      key: 'chart.sql_instructions_retrieved',
      title: '未找到可复用的 SQL 指令',
      status: 'finished',
    }),
    buildStep({
      key: 'preview',
      title:
        previewStatus === 'running'
          ? '正在获取图表预览数据'
          : previewStatus === 'failed'
            ? '图表预览数据获取失败'
            : `已获取 ${previewRows} 行预览数据`,
      description:
        previewRows > 0 && previewColumns > 0
          ? `已准备 ${previewRows} 行 × ${previewColumns} 列的图表样本数据`
          : diagnostics?.lastErrorMessage || null,
      status: previewStatus,
      tags: previewColumnNames.slice(0, 6) as string[],
    }),
    buildStep({
      key: 'chart.intent_recognized',
      title: '已识别用户意图',
      description: '当前追问已被识别为图表生成请求',
      status: 'finished',
    }),
    buildStep({
      key: 'chart.chart_instructions_retrieved',
      title: '未找到图表指令',
      status: 'finished',
    }),
    buildStep({
      key: 'intent',
      title: intentStatus === 'pending' ? '等待识别图表意图' : '已识别图表意图',
      description: '系统正在将当前追问解释为图表生成任务',
      status: intentStatus,
    }),
    buildStep({
      key: 'chartType',
      title:
        chartTypeStatus === 'running'
          ? '正在选择图表类型'
          : chartTypeStatus === 'failed'
            ? '图表类型选择失败'
            : chartTypeLabel
              ? `已确定图表类型：${chartTypeLabel}`
              : '已确定图表类型',
      description:
        chartTypeStatus === 'failed'
          ? chartDetail.chartability?.message || null
          : chartDetail.description && chartTypeStatus === 'finished'
            ? chartDetail.description
            : chartTypeStatus === 'running'
              ? '系统正在为当前数据选择更合适的可视化方式'
              : null,
      status: chartTypeStatus,
      detailMarkdown:
        chartDetail.description && chartTypeStatus === 'finished'
          ? chartDetail.description
          : null,
    }),
    buildStep({
      key: 'generation',
      title:
        generationStatus === 'running'
          ? '正在生成图表'
          : generationStatus === 'failed'
            ? '图表生成失败'
            : '图表已生成',
      description:
        generationStatus === 'failed'
          ? chartDetail.error?.message || diagnostics?.lastErrorMessage || null
          : generationStatus === 'finished'
            ? '图表配置已生成，可在右侧工作台继续查看与调整'
            : null,
      status: generationStatus,
    }),
    buildStep({
      key: 'validation',
      title:
        validationStatus === 'running'
          ? '正在校验图表结果'
          : validationStatus === 'failed'
            ? '图表校验失败'
            : '图表已通过校验',
      description:
        validationStatus === 'finished'
          ? chartDetail.canonicalizationVersion
            ? `已通过 ${chartDetail.canonicalizationVersion} 校验`
            : '图表结构校验通过'
          : validationMessage,
      status: validationStatus,
    }),
  ];
};

export const getPreparationStepCountLabel = (model: PreparationTimelineModel) =>
  `${model.totalSteps} 个步骤`;

export const resolvePreparationTimelineModel = ({
  askingStreamTask,
  data,
  preparedTask,
}: {
  askingStreamTask?: string;
  data: ThreadResponse;
  preparedTask?: PreparedTask | null;
}): PreparationTimelineModel | null => {
  const resolvedIntentKind = data.resolvedIntent?.kind || null;
  const shouldPreferChartTimeline =
    Boolean(data.chartDetail) &&
    (resolvedIntentKind === 'CHART' || !preparedTask);

  if (shouldPreferChartTimeline && data.chartDetail) {
    const steps = resolveChartSteps(data.chartDetail);

    return {
      chartDetail: data.chartDetail,
      kind: 'chart',
      lifecycle: resolveChartLifecycle(data.chartDetail.status),
      steps,
      title: PREPARATION_TITLE,
      totalSteps: steps.length,
    };
  }

  if (preparedTask) {
    const steps = resolveAskSteps({
      askingStreamTask,
      data,
      preparedTask,
    });

    return {
      kind: 'ask',
      lifecycle: resolveAskLifecycle({
        answerStatus: data.answerDetail?.status,
        preparedTask,
      }),
      preparedTask,
      steps,
      title: PREPARATION_TITLE,
      totalSteps: steps.length,
    };
  }

  if (data.chartDetail) {
    const steps = resolveChartSteps(data.chartDetail);

    return {
      chartDetail: data.chartDetail,
      kind: 'chart',
      lifecycle: resolveChartLifecycle(data.chartDetail.status),
      steps,
      title: PREPARATION_TITLE,
      totalSteps: steps.length,
    };
  }

  return null;
};
