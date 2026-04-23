import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import { IWrenAIAdaptor } from '@server/adaptors/wrenAIAdaptor';
import {
  AdjustmentBackgroundTaskTracker,
  ChartAdjustmentBackgroundTracker,
  ChartBackgroundTracker,
  ThreadResponseRecommendQuestionBackgroundTracker,
  ThreadRecommendQuestionBackgroundTracker,
} from '../backgrounds';
import { TextBasedAnswerBackgroundTracker } from '../backgrounds/textBasedAnswerBackgroundTracker';
import {
  IAskingTaskRepository,
  IKnowledgeBaseRepository,
  IViewRepository,
} from '../repositories';
import { IThreadRepository } from '../repositories/threadRepository';
import { IThreadResponseRepository } from '../repositories/threadResponseRepository';
import { PostHogTelemetry } from '../telemetry/telemetry';
import { IAskingTaskTracker } from './askingTaskTracker';
import { IDeployService } from './deployService';
import { IProjectService } from './projectService';
import { IQueryService, PreviewDataResponse } from './queryService';
import { ISkillService } from './skillService';
import {
  AdjustmentReasoningInput,
  AdjustmentSqlInput,
  AskingDetailTaskInput,
  AskingDetailTaskUpdateInput,
  AskingPayload,
  AskingServiceConstructorArgs,
  AskingTaskInput,
  BreakdownBackgroundTracker,
  constructCteSql,
  IAskingService,
  InstantRecommendedQuestionTask,
  InstantRecommendedQuestionsInput,
  RecommendQuestionResultStatus,
  Task,
  ThreadRecommendQuestionResult,
  ThreadResponseAnswerStatus,
} from './askingServiceShared';
import { applyAskingServiceActionPrototype } from './askingServicePrototypeActions';
import { applyAskingServiceHelperPrototype } from './askingServicePrototypeHelpers';

export class AskingService implements IAskingService {
  private instantRecommendedQuestionTasks = new Map<
    string,
    InstantRecommendedQuestionTask
  >();
  private wrenAIAdaptor: IWrenAIAdaptor;
  private deployService: IDeployService;
  private projectService: IProjectService;
  private viewRepository: IViewRepository;
  private threadRepository: IThreadRepository;
  private threadResponseRepository: IThreadResponseRepository;
  private breakdownBackgroundTracker: BreakdownBackgroundTracker;
  private textBasedAnswerBackgroundTracker: TextBasedAnswerBackgroundTracker;
  private chartBackgroundTracker: ChartBackgroundTracker;
  private chartAdjustmentBackgroundTracker: ChartAdjustmentBackgroundTracker;
  private threadRecommendQuestionBackgroundTracker: ThreadRecommendQuestionBackgroundTracker;
  private threadResponseRecommendQuestionBackgroundTracker: ThreadResponseRecommendQuestionBackgroundTracker;
  private queryService: IQueryService;
  private telemetry: PostHogTelemetry;
  private askingTaskTracker: IAskingTaskTracker;
  private askingTaskRepository: IAskingTaskRepository;
  private adjustmentBackgroundTracker: AdjustmentBackgroundTaskTracker;
  private knowledgeBaseRepository?: Pick<
    IKnowledgeBaseRepository,
    'findOneBy' | 'findAll'
  >;
  private skillService?: Pick<ISkillService, 'getSkillDefinitionById'>;
  private backgroundTrackerWorkspaceId?: string | null;

  declare public initialize: () => Promise<void>;
  declare public createAskingTask: IAskingService['createAskingTask'];
  declare public rerunAskingTask: IAskingService['rerunAskingTask'];
  declare public cancelAskingTask: IAskingService['cancelAskingTask'];
  declare public getAskingTask: IAskingService['getAskingTask'];
  declare public getAskingTaskById: IAskingService['getAskingTaskById'];
  declare public createThread: IAskingService['createThread'];
  declare public updateThreadScoped: IAskingService['updateThreadScoped'];
  declare public deleteThreadScoped: IAskingService['deleteThreadScoped'];
  declare public listThreads: IAskingService['listThreads'];
  declare public assertThreadScope: IAskingService['assertThreadScope'];
  declare public assertAskingTaskScope: IAskingService['assertAskingTaskScope'];
  declare public assertAskingTaskScopeById: IAskingService['assertAskingTaskScopeById'];
  declare public assertResponseScope: IAskingService['assertResponseScope'];
  declare public createThreadResponseScoped: IAskingService['createThreadResponseScoped'];
  declare public updateThreadResponseScoped: IAskingService['updateThreadResponseScoped'];
  declare public getResponsesWithThreadScoped: IAskingService['getResponsesWithThreadScoped'];
  declare public getResponseScoped: IAskingService['getResponseScoped'];
  declare public generateThreadResponseBreakdownScoped: IAskingService['generateThreadResponseBreakdownScoped'];
  declare public generateThreadResponseAnswerScoped: IAskingService['generateThreadResponseAnswerScoped'];
  declare public generateThreadResponseChartScoped: IAskingService['generateThreadResponseChartScoped'];
  declare public adjustThreadResponseChartScoped: IAskingService['adjustThreadResponseChartScoped'];
  declare public adjustThreadResponseWithSQLScoped: IAskingService['adjustThreadResponseWithSQLScoped'];
  declare public adjustThreadResponseAnswerScoped: IAskingService['adjustThreadResponseAnswerScoped'];
  declare public cancelAdjustThreadResponseAnswer: IAskingService['cancelAdjustThreadResponseAnswer'];
  declare public rerunAdjustThreadResponseAnswer: IAskingService['rerunAdjustThreadResponseAnswer'];
  declare public getAdjustmentTask: IAskingService['getAdjustmentTask'];
  declare public getAdjustmentTaskById: IAskingService['getAdjustmentTaskById'];
  declare public changeThreadResponseAnswerDetailStatusScoped: IAskingService['changeThreadResponseAnswerDetailStatusScoped'];
  declare public previewDataScoped: IAskingService['previewDataScoped'];
  declare public previewBreakdownDataScoped: IAskingService['previewBreakdownDataScoped'];
  declare public generateThreadResponseRecommendationsScoped: IAskingService['generateThreadResponseRecommendationsScoped'];
  declare public createInstantRecommendedQuestions: IAskingService['createInstantRecommendedQuestions'];
  declare public getInstantRecommendedQuestions: IAskingService['getInstantRecommendedQuestions'];
  declare public generateThreadRecommendationQuestions: IAskingService['generateThreadRecommendationQuestions'];
  declare public getThreadRecommendationQuestions: IAskingService['getThreadRecommendationQuestions'];
  declare public deleteAllByProjectId: IAskingService['deleteAllByProjectId'];

  declare public updateThread: (
    threadId: number,
    input: Partial<AskingDetailTaskUpdateInput>,
  ) => Promise<any>;
  declare public deleteThread: (threadId: number) => Promise<void>;
  declare public createThreadResponse: (
    input: AskingDetailTaskInput,
    threadId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ) => Promise<any>;
  declare public updateThreadResponse: (
    responseId: number,
    data: { sql: string },
  ) => Promise<any>;
  declare public generateThreadResponseBreakdown: (
    threadResponseId: number,
    configurations: { language: string },
  ) => Promise<any>;
  declare public generateThreadResponseAnswer: (
    threadResponseId: number,
    configurations?: { language: string },
  ) => Promise<any>;
  declare public generateThreadResponseChart: (
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    configurations: { language: string },
    runtimeScopeId?: string | null,
  ) => Promise<any>;
  declare public generateThreadResponseRecommendations: (
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    configurations: { language: string; question?: string | null },
    runtimeScopeId?: string | null,
  ) => Promise<any>;
  declare public adjustThreadResponseChart: (
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    input: any,
    configurations?: { language: string },
    runtimeScopeId?: string | null,
  ) => Promise<any>;
  declare public getResponsesWithThread: (
    threadId: number,
    runtimeIdentity?: PersistedRuntimeIdentity,
  ) => Promise<any[]>;
  declare public getResponse: (responseId: number) => Promise<any>;
  declare public previewData: (
    responseId: number,
    limit?: number,
    fallbackRuntimeIdentity?: PersistedRuntimeIdentity | null,
  ) => Promise<PreviewDataResponse>;
  declare public previewBreakdownData: (
    responseId: number,
    stepIndex?: number,
    limit?: number,
    fallbackRuntimeIdentity?: PersistedRuntimeIdentity | null,
  ) => Promise<PreviewDataResponse>;
  declare public changeThreadResponseAnswerDetailStatus: (
    responseId: number,
    status: ThreadResponseAnswerStatus,
    content?: string,
  ) => Promise<any>;
  declare public adjustThreadResponseWithSQL: (
    threadResponseId: number,
    input: AdjustmentSqlInput,
    fallbackRuntimeIdentity?: PersistedRuntimeIdentity | null,
  ) => Promise<any>;
  declare public adjustThreadResponseAnswer: (
    threadResponseId: number,
    input: AdjustmentReasoningInput,
    configurations: { language: string },
    runtimeScopeId?: string | null,
  ) => Promise<any>;

  declare public getDeployId: (
    runtimeIdentity: PersistedRuntimeIdentity,
  ) => Promise<any>;
  declare public getProjectAndDeployment: (
    runtimeIdentity: PersistedRuntimeIdentity,
  ) => Promise<any>;
  declare public resolveScopedKnowledgeBaseIds: (
    inputKnowledgeBaseIds?: string[] | null,
    thread?: any,
    runtimeIdentity?: PersistedRuntimeIdentity | null,
  ) => string[];
  declare public resolveRuntimeIdentityFromKnowledgeSelection: (
    runtimeIdentity: PersistedRuntimeIdentity,
    knowledgeBaseIds: string[],
  ) => Promise<PersistedRuntimeIdentity>;
  declare public resolveScopedSelectedSkillIds: (
    inputSelectedSkillIds?: string[] | null,
    thread?: any,
  ) => string[] | undefined;
  declare public resolveRetrievalScopeIds: (
    knowledgeBaseIds: string[],
    runtimeIdentity: PersistedRuntimeIdentity,
  ) => Promise<string[]>;
  declare public resolveAskingRuntimeIdentity: (
    payload: AskingPayload,
    threadRuntimeIdentity?: PersistedRuntimeIdentity | null,
  ) => PersistedRuntimeIdentity;
  declare public buildPersistedRuntimeIdentityPatch: (
    runtimeIdentity: PersistedRuntimeIdentity,
  ) => PersistedRuntimeIdentity;
  declare public ensureTrackedAskingTaskPersisted: (
    queryId: string,
    question: string,
    runtimeIdentity: PersistedRuntimeIdentity,
  ) => Promise<void>;
  declare public getThreadById: (threadId: number) => Promise<any>;
  declare public getThreadRuntimeIdentity: (
    threadId: number,
    fallbackRuntimeIdentity?: PersistedRuntimeIdentity | null,
  ) => Promise<PersistedRuntimeIdentity>;
  declare public getThreadResponseRuntimeIdentity: (
    threadResponse: any,
    fallbackRuntimeIdentity?: PersistedRuntimeIdentity | null,
  ) => Promise<PersistedRuntimeIdentity>;
  declare public getExecutionResources: (
    runtimeIdentity: PersistedRuntimeIdentity,
  ) => Promise<any>;
  declare public getAskingHistory: (
    threadId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    excludeThreadResponseId?: number,
  ) => Promise<any[]>;
  declare public getThreadRecommendationQuestionsConfig: (project: any) => any;
  declare public isLikelyNonChineseQuestions: (
    questions: any[] | undefined | null,
  ) => boolean;
  declare public shouldForceChineseThreadRecommendation: (
    thread: any,
  ) => Promise<boolean>;
  declare public trackInstantRecommendedQuestionTask: (
    queryId: string,
    runtimeIdentity: PersistedRuntimeIdentity,
  ) => void;
  declare public assertInstantRecommendedQuestionTaskScope: (
    queryId: string,
    runtimeIdentity: PersistedRuntimeIdentity,
  ) => void;
  declare public buildManifestBackedProject: (deployment: any) => any;
  declare public mapManifestDataSourceToProjectType: (dataSource: any) => any;
  declare public toAskRuntimeIdentity: (
    runtimeIdentity?: PersistedRuntimeIdentity | null,
  ) => any;
  declare public buildAskTaskRuntimeIdentity: (
    runtimeIdentity: PersistedRuntimeIdentity,
    deployHash?: string | null,
  ) => any;
  declare public normalizeRuntimeScope: (
    runtimeIdentity?: PersistedRuntimeIdentity | null,
  ) => PersistedRuntimeIdentity | null;
  declare public resolveBreakdownBootstrapWorkspaceId: () => Promise<
    string | null
  >;

  constructor({
    telemetry,
    wrenAIAdaptor,
    deployService,
    projectService,
    viewRepository,
    threadRepository,
    threadResponseRepository,
    askingTaskRepository,
    queryService,
    askingTaskTracker,
    skillService,
    knowledgeBaseRepository,
    backgroundTrackerWorkspaceId,
  }: AskingServiceConstructorArgs) {
    ensureAskingServicePrototypePatched();
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.deployService = deployService;
    this.projectService = projectService;
    this.viewRepository = viewRepository;
    this.threadRepository = threadRepository;
    this.threadResponseRepository = threadResponseRepository;
    this.telemetry = telemetry;
    this.queryService = queryService;
    this.breakdownBackgroundTracker = new BreakdownBackgroundTracker({
      telemetry,
      wrenAIAdaptor,
      threadResponseRepository,
    });
    this.textBasedAnswerBackgroundTracker =
      new TextBasedAnswerBackgroundTracker({
        wrenAIAdaptor,
        threadResponseRepository,
        threadRepository,
        projectService,
        deployService,
        queryService,
        knowledgeBaseRepository,
      });
    this.chartBackgroundTracker = new ChartBackgroundTracker({
      telemetry,
      wrenAIAdaptor,
      threadResponseRepository,
    });
    this.chartAdjustmentBackgroundTracker =
      new ChartAdjustmentBackgroundTracker({
        telemetry,
        wrenAIAdaptor,
        threadResponseRepository,
      });
    this.threadRecommendQuestionBackgroundTracker =
      new ThreadRecommendQuestionBackgroundTracker({
        telemetry,
        wrenAIAdaptor,
        threadRepository,
      });
    this.threadResponseRecommendQuestionBackgroundTracker =
      new ThreadResponseRecommendQuestionBackgroundTracker({
        telemetry,
        wrenAIAdaptor,
        threadResponseRepository,
      });
    this.adjustmentBackgroundTracker = new AdjustmentBackgroundTaskTracker({
      telemetry,
      wrenAIAdaptor,
      askingTaskRepository,
      threadResponseRepository,
    });
    this.askingTaskRepository = askingTaskRepository;
    this.askingTaskTracker = askingTaskTracker;
    this.knowledgeBaseRepository = knowledgeBaseRepository;
    this.skillService = skillService;
    this.backgroundTrackerWorkspaceId = backgroundTrackerWorkspaceId ?? null;
  }

  public stopBackgroundTrackers(): void {
    this.breakdownBackgroundTracker.stop();
    this.textBasedAnswerBackgroundTracker.stop();
    this.chartBackgroundTracker.stop();
    this.chartAdjustmentBackgroundTracker.stop();
    this.threadRecommendQuestionBackgroundTracker.stop();
    this.threadResponseRecommendQuestionBackgroundTracker.stop();
    this.adjustmentBackgroundTracker.stopPolling();
  }
}

function ensureAskingServicePrototypePatched() {
  const proto = AskingService.prototype as AskingService & {
    initialize?: unknown;
    normalizeRuntimeScope?: unknown;
  };

  if (typeof proto.initialize !== 'function') {
    applyAskingServiceActionPrototype(AskingService);
  }

  if (typeof proto.normalizeRuntimeScope !== 'function') {
    applyAskingServiceHelperPrototype(AskingService);
  }
}

ensureAskingServicePrototypePatched();

export {
  constructCteSql,
  RecommendQuestionResultStatus,
  ThreadResponseAnswerStatus,
};
export type {
  AdjustmentReasoningInput,
  AdjustmentSqlInput,
  AskingDetailTaskInput,
  AskingDetailTaskUpdateInput,
  AskingPayload,
  AskingServiceConstructorArgs,
  AskingTaskInput,
  IAskingService,
  InstantRecommendedQuestionTask,
  InstantRecommendedQuestionsInput,
  Task,
  ThreadRecommendQuestionResult,
};
