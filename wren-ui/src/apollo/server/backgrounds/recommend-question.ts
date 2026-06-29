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

const MIN_POLL_DELAY = 2000;
const MAX_POLL_DELAY = 10000;

export class ProjectRecommendQuestionBackgroundTracker {
  // tasks is a kv pair of task id and thread response
  private tasks: Record<number, Project> = {};
  private nextPollAt: Record<number, number> = {};
  private pollDelay: Record<number, number> = {};
  private intervalTime: number;
  private wrenAIAdaptor: IWrenAIAdaptor;
  private projectRepository: IProjectRepository;
  private runningJobs = new Set();
  private telemetry: ITelemetry;
  private logger: Logger;
  private initialized = false;
  private intervalId?: NodeJS.Timeout;

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
    this.logger.level = 'info';
    this.telemetry = telemetry;
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.projectRepository = projectRepository;
    this.intervalTime = 1000;
    this.start();
  }

  public start() {
    if (this.intervalId) {
      return;
    }
    this.logger.info('Recommend question background tracker started');
    this.intervalId = setInterval(() => {
      const jobs = Object.values(this.tasks).map((project) => async () => {
        // check if same job is running
        if (this.runningJobs.has(this.taskKey(project))) {
          return;
        }

        if (Date.now() < (this.nextPollAt[this.taskKey(project)] || 0)) {
          return;
        }

        // mark the job as running
        this.runningJobs.add(this.taskKey(project));

        // get the latest result from AI service

        const result =
          await this.wrenAIAdaptor.getRecommendationQuestionsResult(
            project.queryId,
          );

        const changed =
          project.questionsStatus !== result.status ||
          result.response?.questions.length !==
            (project.questions || []).length;
        this.scheduleNextPoll(this.taskKey(project), result.status, changed);

        if (isFinalized(result.status) && !changed) {
          this.finalizeTask(project, result);
          this.runningJobs.delete(this.taskKey(project));
          return;
        }

        // check if status change
        if (!changed) {
          // mark the job as finished
          this.runningJobs.delete(this.taskKey(project));
          return;
        }

        // update database
        if (changed) {
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
          this.finalizeTask(project, result);
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

  public stop() {
    if (!this.intervalId) {
      return;
    }
    clearInterval(this.intervalId);
    this.intervalId = undefined;
  }

  public addTask(project: Project) {
    this.tasks[this.taskKey(project)] = project;
    this.nextPollAt[this.taskKey(project)] = Date.now();
    this.pollDelay[this.taskKey(project)] = MIN_POLL_DELAY;
  }

  public getTasks() {
    return this.tasks;
  }

  public async initialize() {
    if (this.initialized) {
      return;
    }

    const projects = await this.projectRepository.findAll();
    for (const project of projects) {
      if (
        this.taskKey(project) &&
        !isFinalized(project.questionsStatus as RecommendationQuestionStatus)
      ) {
        this.addTask(project);
      }
    }

    this.initialized = true;
  }

  public taskKey(project: Project) {
    return project.id;
  }

  public isExist(project: Project) {
    return this.tasks[this.taskKey(project)];
  }

  private scheduleNextPoll(
    taskKey: number,
    status: RecommendationQuestionStatus,
    resultChanged: boolean,
  ) {
    if (isFinalized(status)) {
      this.nextPollAt[taskKey] = Number.MAX_SAFE_INTEGER;
      return;
    }

    this.pollDelay[taskKey] = resultChanged
      ? MIN_POLL_DELAY
      : Math.min(
          Math.max(
            (this.pollDelay[taskKey] || MIN_POLL_DELAY) * 1.5,
            MIN_POLL_DELAY,
          ),
          MAX_POLL_DELAY,
        );
    this.nextPollAt[taskKey] = Date.now() + this.pollDelay[taskKey];
  }

  private finalizeTask(project: Project, result) {
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
    const taskKey = this.taskKey(project);
    this.logger.debug(`${loggerPrefix}job ${taskKey} is finalized, removing`);
    delete this.tasks[taskKey];
    delete this.nextPollAt[taskKey];
    delete this.pollDelay[taskKey];
  }
}

export class ThreadRecommendQuestionBackgroundTracker {
  // tasks is a kv pair of task id and thread response
  private tasks: Record<number, Thread> = {};
  private nextPollAt: Record<number, number> = {};
  private pollDelay: Record<number, number> = {};
  private intervalTime: number;
  private wrenAIAdaptor: IWrenAIAdaptor;
  private threadRepository: IThreadRepository;
  private runningJobs = new Set();
  private telemetry: ITelemetry;
  private logger: Logger;
  private initialized = false;
  private intervalId?: NodeJS.Timeout;

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
    this.logger.level = 'info';
    this.telemetry = telemetry;
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.threadRepository = threadRepository;
    this.intervalTime = 1000;
    this.start();
  }

  public start() {
    if (this.intervalId) {
      return;
    }
    this.logger.info('Recommend question background tracker started');
    this.intervalId = setInterval(() => {
      const jobs = Object.values(this.tasks).map((thread) => async () => {
        // check if same job is running
        if (this.runningJobs.has(this.taskKey(thread))) {
          return;
        }

        if (Date.now() < (this.nextPollAt[this.taskKey(thread)] || 0)) {
          return;
        }

        // mark the job as running
        this.runningJobs.add(this.taskKey(thread));

        // get the latest result from AI service

        const result =
          await this.wrenAIAdaptor.getRecommendationQuestionsResult(
            thread.queryId,
          );

        const changed =
          thread.questionsStatus !== result.status ||
          result.response?.questions.length !== (thread.questions || []).length;
        this.scheduleNextPoll(this.taskKey(thread), result.status, changed);

        if (isFinalized(result.status) && !changed) {
          this.finalizeTask(thread, result);
          this.runningJobs.delete(this.taskKey(thread));
          return;
        }

        // check if status change
        if (!changed) {
          // mark the job as finished
          this.runningJobs.delete(this.taskKey(thread));
          return;
        }

        // update database
        if (changed) {
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
          this.finalizeTask(thread, result);
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

  public stop() {
    if (!this.intervalId) {
      return;
    }
    clearInterval(this.intervalId);
    this.intervalId = undefined;
  }

  public addTask(thread: Thread) {
    this.tasks[this.taskKey(thread)] = thread;
    this.nextPollAt[this.taskKey(thread)] = Date.now();
    this.pollDelay[this.taskKey(thread)] = MIN_POLL_DELAY;
  }

  public getTasks() {
    return this.tasks;
  }

  public async initialize() {
    if (this.initialized) {
      return;
    }

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

    this.initialized = true;
  }

  public taskKey(thread: Thread) {
    return thread.id;
  }

  public isExist(thread: Thread) {
    return this.tasks[this.taskKey(thread)];
  }

  private scheduleNextPoll(
    taskKey: number,
    status: RecommendationQuestionStatus,
    resultChanged: boolean,
  ) {
    if (isFinalized(status)) {
      this.nextPollAt[taskKey] = Number.MAX_SAFE_INTEGER;
      return;
    }

    this.pollDelay[taskKey] = resultChanged
      ? MIN_POLL_DELAY
      : Math.min(
          Math.max(
            (this.pollDelay[taskKey] || MIN_POLL_DELAY) * 1.5,
            MIN_POLL_DELAY,
          ),
          MAX_POLL_DELAY,
        );
    this.nextPollAt[taskKey] = Date.now() + this.pollDelay[taskKey];
  }

  private finalizeTask(thread: Thread, result) {
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
    const taskKey = this.taskKey(thread);
    this.logger.debug(`${loggerPrefix}job ${taskKey} is finalized, removing`);
    delete this.tasks[taskKey];
    delete this.nextPollAt[taskKey];
    delete this.pollDelay[taskKey];
  }
}
