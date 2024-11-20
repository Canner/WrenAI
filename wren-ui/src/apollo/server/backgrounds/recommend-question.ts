import { IProjectRepository } from '../repositories/projectRepository';
import { RecommendationQuestionStatus } from '@server/models/adaptor';
import { IWrenAIAdaptor } from '../adaptors/wrenAIAdaptor';
import { IThreadRepository, Project, Thread } from '../repositories';
import {
  ITelemetry,
  TelemetryEvent,
  WrenService,
} from '../telemetry/telemetry';
import { getLogger } from '../utils/logger';
import { Logger } from 'log4js';

// PRQ background tracker : project recommend question background tracker
const loggerPrefix = 'PRQBT:';

const isFinalized = (status: RecommendationQuestionStatus) => {
  return [
    RecommendationQuestionStatus.FINISHED,
    RecommendationQuestionStatus.FAILED,
  ].includes(status);
};

export class ProjectRecommendQuestionBackgroundTracker {
  // tasks is a kv pair of task id and thread response
  private tasks: Record<number, Project> = {};
  private intervalTime: number;
  private wrenAIAdaptor: IWrenAIAdaptor;
  private projectRepository: IProjectRepository;
  private runningJobs = new Set();
  private telemetry: ITelemetry;
  private logger: Logger;

  constructor({
    telemetry,
    wrenAIAdaptor,
    projectRepository,
  }: {
    telemetry: ITelemetry;
    wrenAIAdaptor: IWrenAIAdaptor;
    projectRepository: IProjectRepository;
  }) {
    this.logger = getLogger('PRQ Background Tracker');
    this.logger.level = 'debug';
    this.telemetry = telemetry;
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.projectRepository = projectRepository;
    this.intervalTime = 1000;
    this.start();
  }

  public start() {
    this.logger.info('Recommend question background tracker started');
    setInterval(() => {
      const jobs = Object.values(this.tasks).map((project) => async () => {
        // check if same job is running
        if (this.runningJobs.has(this.taskKey(project))) {
          return;
        }

        // mark the job as running
        this.runningJobs.add(this.taskKey(project));

        // get the latest result from AI service

        const result =
          await this.wrenAIAdaptor.getRecommendationQuestionsResult(
            project.queryId,
          );

        // check if status change
        if (
          project.questionsStatus === result.status &&
          result.response?.questions.length === (project.questions || []).length
        ) {
          // mark the job as finished
          this.logger.debug(
            `${loggerPrefix}job ${this.taskKey(project)} status not changed, returning question count: ${result.response?.questions.length || 0}`,
          );
          this.runningJobs.delete(this.taskKey(project));
          return;
        }

        // update database
        if (
          result.status !== project.questionsStatus ||
          result.response?.questions.length !== (project.questions || []).length
        ) {
          this.logger.debug(
            `${loggerPrefix}job ${this.taskKey(project)} have changes, returning question count: ${result.response?.questions.length || 0}, updating`,
          );
          await this.projectRepository.updateOne(project.id, {
            questionsStatus: result.status.toUpperCase(),
            questions: result.response?.questions,
            questionsError: result.error,
          });
          project.questionsStatus = result.status;
          project.questions = result.response?.questions;
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
              TelemetryEvent.HOME_GENERATE_PROJECT_RECOMMENDATION_QUESTIONS,
              eventProperties,
            );
          } else {
            this.telemetry.sendEvent(
              TelemetryEvent.HOME_GENERATE_PROJECT_RECOMMENDATION_QUESTIONS,
              eventProperties,
              WrenService.AI,
              false,
            );
          }
          this.logger.debug(
            `${loggerPrefix}job ${this.taskKey(project)} is finalized, removing`,
          );
          delete this.tasks[this.taskKey(project)];
        }

        // mark the job as finished
        this.runningJobs.delete(this.taskKey(project));
      });

      // run the jobs
      Promise.allSettled(jobs.map((job) => job())).then((results) => {
        // show reason of rejection
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            this.logger.error(`Job ${index} failed: ${result.reason}`);
          }
        });
      });
    }, this.intervalTime);
  }

  public addTask(project: Project) {
    this.tasks[this.taskKey(project)] = project;
  }

  public getTasks() {
    return this.tasks;
  }

  public async initialize() {
    const projects = await this.projectRepository.findAll();
    for (const project of projects) {
      if (
        this.taskKey(project) &&
        !isFinalized(project.questionsStatus as RecommendationQuestionStatus)
      ) {
        this.addTask(project);
      }
    }
  }

  public taskKey(project: Project) {
    return project.id;
  }

  public isExist(project: Project) {
    return this.tasks[this.taskKey(project)];
  }
}

export class ThreadRecommendQuestionBackgroundTracker {
  // tasks is a kv pair of task id and thread response
  private tasks: Record<number, Thread> = {};
  private intervalTime: number;
  private wrenAIAdaptor: IWrenAIAdaptor;
  private threadRepository: IThreadRepository;
  private runningJobs = new Set();
  private telemetry: ITelemetry;
  private logger: Logger;

  constructor({
    telemetry,
    wrenAIAdaptor,
    threadRepository,
  }: {
    telemetry: ITelemetry;
    wrenAIAdaptor: IWrenAIAdaptor;
    threadRepository: IThreadRepository;
  }) {
    this.logger = getLogger('TRQ Background Tracker');
    this.logger.level = 'debug';
    this.telemetry = telemetry;
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.threadRepository = threadRepository;
    this.intervalTime = 1000;
    this.start();
  }

  public start() {
    this.logger.info('Recommend question background tracker started');
    setInterval(() => {
      const jobs = Object.values(this.tasks).map((thread) => async () => {
        // check if same job is running
        if (this.runningJobs.has(this.taskKey(thread))) {
          return;
        }

        // mark the job as running
        this.runningJobs.add(this.taskKey(thread));

        // get the latest result from AI service

        const result =
          await this.wrenAIAdaptor.getRecommendationQuestionsResult(
            thread.queryId,
          );

        // check if status change
        if (
          thread.questionsStatus === result.status &&
          result.response?.questions.length === (thread.questions || []).length
        ) {
          // mark the job as finished
          this.logger.debug(
            `${loggerPrefix}job ${this.taskKey(thread)} status not changed, returning question count: ${result.response?.questions.length || 0}`,
          );
          this.runningJobs.delete(this.taskKey(thread));
          return;
        }

        // update database
        if (
          result.status !== thread.questionsStatus ||
          result.response?.questions.length !== (thread.questions || []).length
        ) {
          this.logger.debug(
            `${loggerPrefix}job ${this.taskKey(thread)} have changes, returning question count: ${result.response?.questions.length || 0}, updating`,
          );
          await this.threadRepository.updateOne(thread.id, {
            questionsStatus: result.status.toUpperCase(),
            questions: result.response?.questions,
            questionsError: result.error,
          });
          thread.questionsStatus = result.status;
          thread.questions = result.response?.questions;
        }

        // remove the task from tracker if it is finalized
        if (isFinalized(result.status)) {
          const eventProperties = {
            thread_id: thread.id,
            status: result.status,
            questions: thread.questions,
            error: result.error,
          };
          if (result.status === RecommendationQuestionStatus.FINISHED) {
            this.telemetry.sendEvent(
              TelemetryEvent.HOME_GENERATE_THREAD_RECOMMENDATION_QUESTIONS,
              eventProperties,
            );
          } else {
            this.telemetry.sendEvent(
              TelemetryEvent.HOME_GENERATE_THREAD_RECOMMENDATION_QUESTIONS,
              eventProperties,
              WrenService.AI,
              false,
            );
          }
          this.logger.debug(
            `${loggerPrefix}job ${this.taskKey(thread)} is finalized, removing`,
          );
          delete this.tasks[this.taskKey(thread)];
        }

        // mark the job as finished
        this.runningJobs.delete(this.taskKey(thread));
      });

      // run the jobs
      Promise.allSettled(jobs.map((job) => job())).then((results) => {
        // show reason of rejection
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            this.logger.error(`Job ${index} failed: ${result.reason}`);
          }
        });
      });
    }, this.intervalTime);
  }

  public addTask(thread: Thread) {
    this.tasks[this.taskKey(thread)] = thread;
  }

  public getTasks() {
    return this.tasks;
  }

  public async initialize() {
    const threads = await this.threadRepository.findAll();
    for (const thread of threads) {
      if (
        !this.tasks[this.taskKey(thread)] &&
        thread.queryId &&
        !isFinalized(thread.questionsStatus as RecommendationQuestionStatus)
      ) {
        this.addTask(thread);
      }
    }
  }

  public taskKey(thread: Thread) {
    return thread.id;
  }

  public isExist(thread: Thread) {
    return this.tasks[this.taskKey(thread)];
  }
}
