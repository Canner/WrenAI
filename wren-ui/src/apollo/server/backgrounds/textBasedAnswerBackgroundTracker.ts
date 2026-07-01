import { IWrenAIAdaptor } from '../adaptors';
import {
  WrenAILanguage,
  TextBasedAnswerResult,
  TextBasedAnswerStatus,
} from '../models/adaptor';
import {
  ThreadResponse,
  IThreadRepository,
  IThreadResponseRepository,
} from '../repositories';
import {
  IProjectService,
  IDeployService,
  IQueryService,
  ThreadResponseAnswerStatus,
  PreviewDataResponse,
} from '../services';
import { getLogger } from '@server/utils';

const logger = getLogger('TextBasedAnswerBackgroundTracker');
logger.level = 'debug';

const ANSWER_PREVIEW_LIMIT = 50;

const formatValue = (value: unknown) => {
  if (value === null || value === undefined || value === '') {
    return '(blank)';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toString() : value.toLocaleString();
  }
  return String(value);
};

const buildFastAnswer = (
  question: string,
  data: PreviewDataResponse,
): string | null => {
  const rows = data?.data || [];
  const columns = data?.columns || [];
  if (!columns.length) {
    return null;
  }
  if (!rows.length) {
    return 'No rows were returned for this question.';
  }

  const columnNames = columns.map((column) => column.name);
  const rowCount = rows.length;
  const sampleRows = rows.slice(0, Math.min(rowCount, 10));
  const hasMetricColumn = columns.some((column) =>
    /count|total|sum|amount|value|revenue|sales|qty|quantity|rate|percent/i.test(
      column.name,
    ),
  );
  const questionPrefix = question ? `For "${question}", ` : '';

  if (columns.length === 1) {
    const values = sampleRows.map((row) => formatValue(row[0])).join(', ');
    const columnName = columnNames[0];
    const isCountColumn = /count|recordcount|rowcount/i.test(columnName);
    if (isCountColumn && Number(sampleRows[0]?.[0]) === 0) {
      return `${questionPrefix}the active datasource returned 0 matching records.`;
    }
    return `${questionPrefix}the query returned ${rowCount} row${
      rowCount === 1 ? '' : 's'
    }. Values: ${values}.`;
  }

  if (columns.length === 2 && hasMetricColumn) {
    const [labelColumn, metricColumn] = columnNames;
    const lines = sampleRows.map(
      (row, index) =>
        `${index + 1}. ${formatValue(row[0])}: ${formatValue(row[1])}`,
    );
    return [
      `${questionPrefix}the top ${sampleRows.length} results by ${metricColumn} are:`,
      ...lines,
      `Columns used: ${labelColumn}, ${metricColumn}.`,
    ].join('\n');
  }

  const preview = sampleRows
    .map((row, index) => {
      const values = columnNames
        .map((columnName, columnIndex) => {
          return `${columnName}: ${formatValue(row[columnIndex])}`;
        })
        .join(', ');
      return `${index + 1}. ${values}`;
    })
    .join('\n');

  return [
    `${questionPrefix}the query returned ${rowCount} row${
      rowCount === 1 ? '' : 's'
    }. Showing the first ${sampleRows.length}:`,
    preview,
  ].join('\n');
};

export class TextBasedAnswerBackgroundTracker {
  // tasks is a kv pair of task id and thread response
  private tasks: Record<number, ThreadResponse> = {};
  private intervalTime: number;
  private wrenAIAdaptor: IWrenAIAdaptor;
  private threadRepository: IThreadRepository;
  private threadResponseRepository: IThreadResponseRepository;
  private projectService: IProjectService;
  private deployService: IDeployService;
  private queryService: IQueryService;
  private runningJobs = new Set();

  constructor({
    wrenAIAdaptor,
    threadRepository,
    threadResponseRepository,
    projectService,
    deployService,
    queryService,
  }: {
    wrenAIAdaptor: IWrenAIAdaptor;
    threadRepository: IThreadRepository;
    threadResponseRepository: IThreadResponseRepository;
    projectService: IProjectService;
    deployService: IDeployService;
    queryService: IQueryService;
  }) {
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.threadRepository = threadRepository;
    this.threadResponseRepository = threadResponseRepository;
    this.projectService = projectService;
    this.deployService = deployService;
    this.queryService = queryService;
    this.intervalTime = 1000;
    this.start();
  }

  private start() {
    setInterval(async () => {
      const jobs = Object.values(this.tasks).map(
        (threadResponse) => async () => {
          if (
            this.runningJobs.has(threadResponse.id) ||
            !threadResponse.answerDetail
          ) {
            return;
          }
          this.runningJobs.add(threadResponse.id);

          try {
            const answerDetail = threadResponse.answerDetail;

            if (
              !answerDetail.queryId &&
              answerDetail.status !== ThreadResponseAnswerStatus.FETCHING_DATA
            ) {
              const fetchingDetail = {
                ...answerDetail,
                status: ThreadResponseAnswerStatus.FETCHING_DATA,
              };
              await this.threadResponseRepository.updateOne(threadResponse.id, {
                answerDetail: fetchingDetail,
              });
              threadResponse.answerDetail = fetchingDetail;

              const thread = await this.threadRepository.findOneBy({
                id: threadResponse.threadId,
              });
              if (!thread) {
                throw new Error(`Thread ${threadResponse.threadId} not found`);
              }
              const project = await this.projectService.getProjectById(
                thread.projectId,
              );
              const deployment = await this.deployService.getLastDeployment(
                project.id,
              );
              const mdl = deployment.manifest;
              let data: PreviewDataResponse;
              try {
                data = (await this.queryService.preview(threadResponse.sql, {
                  project,
                  manifest: mdl,
                  modelingOnly: false,
                  limit: ANSWER_PREVIEW_LIMIT,
                  cacheEnabled: false,
                })) as PreviewDataResponse;
              } catch (error) {
                logger.error(`Error when query sql data: ${error}`);
                const failedDetail = {
                  ...threadResponse.answerDetail,
                  status: ThreadResponseAnswerStatus.FAILED,
                  error: error?.extensions || error,
                };
                await this.threadResponseRepository.updateOne(threadResponse.id, {
                  answerDetail: failedDetail,
                });
                threadResponse.answerDetail = failedDetail;
                delete this.tasks[threadResponse.id];
                throw error;
              }

              const fastAnswer = buildFastAnswer(threadResponse.question, data);
              if (fastAnswer) {
                const finishedDetail = {
                  ...threadResponse.answerDetail,
                  status: ThreadResponseAnswerStatus.FINISHED,
                  content: fastAnswer,
                  numRowsUsedInLLM: Math.min(
                    data?.data?.length || 0,
                    ANSWER_PREVIEW_LIMIT,
                  ),
                };
                await this.threadResponseRepository.updateOne(threadResponse.id, {
                  answerDetail: finishedDetail,
                });
                threadResponse.answerDetail = finishedDetail;
                delete this.tasks[threadResponse.id];
                return;
              }

              const response = await this.wrenAIAdaptor.createTextBasedAnswer({
                query: threadResponse.question,
                sql: threadResponse.sql,
                sqlData: data,
                threadId: threadResponse.threadId.toString(),
                configurations: {
                  language: WrenAILanguage[project.language] || WrenAILanguage.EN,
                },
              });

              const preprocessingDetail = {
                ...threadResponse.answerDetail,
                queryId: response.queryId,
                status: ThreadResponseAnswerStatus.PREPROCESSING,
              };
              await this.threadResponseRepository.updateOne(threadResponse.id, {
                answerDetail: preprocessingDetail,
              });
              threadResponse.answerDetail = preprocessingDetail;
              return;
            }

            if (
              answerDetail.queryId &&
              answerDetail.status === ThreadResponseAnswerStatus.PREPROCESSING
            ) {
              const result: TextBasedAnswerResult =
                await this.wrenAIAdaptor.getTextBasedAnswerResult(
                  answerDetail.queryId,
                );

              if (result.status === TextBasedAnswerStatus.PREPROCESSING) {
                return;
              }

              const updatedAnswerDetail = {
                queryId: answerDetail.queryId,
                status:
                  result.status === TextBasedAnswerStatus.SUCCEEDED
                    ? ThreadResponseAnswerStatus.STREAMING
                    : ThreadResponseAnswerStatus.FAILED,
                numRowsUsedInLLM: result.numRowsUsedInLLM,
                error: result.error,
              };
              await this.threadResponseRepository.updateOne(threadResponse.id, {
                answerDetail: updatedAnswerDetail,
              });
              threadResponse.answerDetail = updatedAnswerDetail;
              delete this.tasks[threadResponse.id];
            }
          } catch (error) {
            logger.error(`Answer job ${threadResponse.id} failed: ${error}`);
            const failedDetail = {
              ...threadResponse.answerDetail,
              status: ThreadResponseAnswerStatus.FAILED,
              error: error?.extensions || error,
            };
            await this.threadResponseRepository.updateOne(threadResponse.id, {
              answerDetail: failedDetail,
            });
            threadResponse.answerDetail = failedDetail;
            delete this.tasks[threadResponse.id];
            throw error;
          } finally {
            this.runningJobs.delete(threadResponse.id);
          }
        },
      );

      // Run the jobs
      Promise.allSettled(jobs.map((job) => job())).then((results) => {
        // Show reason of rejection
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            logger.error(`Job ${index} failed: ${result.reason}`);
          }
        });
      });
    }, this.intervalTime);
  }

  public addTask(threadResponse: ThreadResponse) {
    this.tasks[threadResponse.id] = threadResponse;
  }

  public getTasks() {
    return this.tasks;
  }
}
