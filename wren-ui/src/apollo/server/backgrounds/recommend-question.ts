import { IProjectRepository } from '../repositories/projectRepository';
import {
  IWrenAIAdaptor,
  RecommendationQuestionStatus,
} from '../adaptors/wrenAIAdaptor';
import { Project } from '../repositories';
import {
  PostHogTelemetry,
  TelemetryEvent,
  WrenService,
} from '../telemetry/telemetry';
import { getLogger } from '../utils/logger';

const logger = getLogger('recommend-question-background');
logger.level = 'debug';

const loggerPrefix = 'Recommend question ';

const isFinalized = (status: RecommendationQuestionStatus) => {
  return [
    RecommendationQuestionStatus.FINISHED,
    RecommendationQuestionStatus.FAILED,
  ].includes(status);
};

export class RecommendQuestionBackgroundTracker {
  // tasks is a kv pair of task id and thread response
  private tasks: Record<number, Project> = {};
  private intervalTime: number;
  private wrenAIAdaptor: IWrenAIAdaptor;
  private projectRepository: IProjectRepository;
  private runningJobs = new Set();
  private telemetry: PostHogTelemetry;

  constructor({
    telemetry,
    wrenAIAdaptor,
    projectRepository,
  }: {
    telemetry: PostHogTelemetry;
    wrenAIAdaptor: IWrenAIAdaptor;
    projectRepository: IProjectRepository;
  }) {
    this.telemetry = telemetry;
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.projectRepository = projectRepository;
    this.intervalTime = 1000;
    this.start();
  }

  public start() {
    logger.info('Recommend question background tracker started');
    setInterval(() => {
      const jobs = Object.values(this.tasks).map((project) => async () => {
        // check if same job is running
        if (this.runningJobs.has(project.id)) {
          return;
        }

        // mark the job as running
        this.runningJobs.add(project.id);

        // get the latest result from AI service

        const result =
          await this.wrenAIAdaptor.getRecommendationQuestionsResult(
            project.queryId,
          );

        // check if status change
        if (project.questionsStatus === result.status) {
          // mark the job as finished
          logger.debug(`${loggerPrefix}job ${project.id} status not changed`);
          this.runningJobs.delete(project.id);
          return;
        }

        // update database
        if (result.status !== project.questionsStatus) {
          logger.debug(
            `${loggerPrefix}job ${project.id} status changed to ${result.status}, updating`,
          );
          await this.projectRepository.updateOne(project.id, {
            questionsStatus: result.status.toUpperCase(),
            questions: result.response?.questions,
            questionsError: result.error,
          });
          project.questionsStatus = result.status;
        }

        // remove the task from tracker if it is finalized
        if (isFinalized(result.status)) {
          const eventProperties = {
            projectId: project.id,
            projectType: project.type,
            status: result.status,
            questions: project.questions,
            error: result.error,
          };
          if (result.status === RecommendationQuestionStatus.FINISHED) {
            this.telemetry.sendEvent(
              TelemetryEvent.HOME_GENERATE_RECOMMENDATION_QUESTIONS,
              eventProperties,
            );
          } else {
            this.telemetry.sendEvent(
              TelemetryEvent.HOME_GENERATE_RECOMMENDATION_QUESTIONS,
              eventProperties,
              WrenService.AI,
              false,
            );
          }
          logger.debug(
            `${loggerPrefix}job ${project.id} is finalized, removing`,
          );
          delete this.tasks[project.id];
        }

        // mark the job as finished
        this.runningJobs.delete(project.id);
      });

      // run the jobs
      Promise.allSettled(jobs.map((job) => job())).then((results) => {
        // show reason of rejection
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            logger.error(`Job ${index} failed: ${result.reason}`);
          }
        });
      });
    }, this.intervalTime);
  }

  public addTask(project: Project) {
    this.tasks[project.id] = project;
  }

  public getTasks() {
    return this.tasks;
  }

  public async initialize() {
    const projects = await this.projectRepository.findAll();
    for (const project of projects) {
      if (
        project.queryId &&
        !isFinalized(project.questionsStatus as RecommendationQuestionStatus)
      ) {
        this.addTask(project);
      }
    }
  }
}
