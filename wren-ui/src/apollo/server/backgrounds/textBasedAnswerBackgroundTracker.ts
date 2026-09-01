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
                const executionStartedAt = Date.now();
                data = (await this.queryService.preview(threadResponse.sql, {
                  project,
                  manifest: mdl,
                  modelingOnly: false,
                  limit: 500,
                  cacheEnabled: false,
                })) as PreviewDataResponse;
                logger.info(
                  `Ask timing stage=sql_execution response_id=${
                    threadResponse.id
                  } project_id=${project.id} elapsed_ms=${
                    Date.now() - executionStartedAt
                  } row_count=${data?.data?.length ?? ''}`,
                );
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

              const answerRequestStartedAt = Date.now();
              const response = await this.wrenAIAdaptor.createTextBasedAnswer({
                query: threadResponse.question,
                sql: threadResponse.sql,
                sqlData: data,
                threadId: threadResponse.threadId.toString(),
                configurations: {
                  language: WrenAILanguage[project.language] || WrenAILanguage.EN,
                },
              });
              logger.info(
                `Ask timing stage=answer_formatting_request response_id=${
                  threadResponse.id
                } project_id=${project.id} query_id=${
                  response.queryId
                } elapsed_ms=${Date.now() - answerRequestStartedAt}`,
              );

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
              const answerPollStartedAt = Date.now();
              const result: TextBasedAnswerResult =
                await this.wrenAIAdaptor.getTextBasedAnswerResult(
                  answerDetail.queryId,
                );
              logger.info(
                `Ask timing stage=answer_formatting_poll response_id=${
                  threadResponse.id
                } query_id=${answerDetail.queryId} elapsed_ms=${
                  Date.now() - answerPollStartedAt
                } status=${result.status}`,
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
