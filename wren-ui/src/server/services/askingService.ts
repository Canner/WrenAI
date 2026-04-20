import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import { IWrenAIAdaptor } from '@server/adaptors/wrenAIAdaptor';
import {
  AdjustmentBackgroundTaskTracker,
  ChartAdjustmentBackgroundTracker,
  ChartBackgroundTracker,
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

  public initialize!: () => Promise<void>;
  public createAskingTask!: IAskingService['createAskingTask'];
  public rerunAskingTask!: IAskingService['rerunAskingTask'];
  public cancelAskingTask!: IAskingService['cancelAskingTask'];
  public getAskingTask!: IAskingService['getAskingTask'];
  public getAskingTaskById!: IAskingService['getAskingTaskById'];
  public createThread!: IAskingService['createThread'];
  public updateThreadScoped!: IAskingService['updateThreadScoped'];
  public deleteThreadScoped!: IAskingService['deleteThreadScoped'];
  public listThreads!: IAskingService['listThreads'];
  public assertThreadScope!: IAskingService['assertThreadScope'];
  public assertAskingTaskScope!: IAskingService['assertAskingTaskScope'];
  public assertAskingTaskScopeById!: IAskingService['assertAskingTaskScopeById'];
  public assertResponseScope!: IAskingService['assertResponseScope'];
  public createThreadResponseScoped!: IAskingService['createThreadResponseScoped'];
  public updateThreadResponseScoped!: IAskingService['updateThreadResponseScoped'];
  public getResponsesWithThreadScoped!: IAskingService['getResponsesWithThreadScoped'];
  public getResponseScoped!: IAskingService['getResponseScoped'];
  public generateThreadResponseBreakdownScoped!: IAskingService['generateThreadResponseBreakdownScoped'];
  public generateThreadResponseAnswerScoped!: IAskingService['generateThreadResponseAnswerScoped'];
  public generateThreadResponseChartScoped!: IAskingService['generateThreadResponseChartScoped'];
  public adjustThreadResponseChartScoped!: IAskingService['adjustThreadResponseChartScoped'];
  public adjustThreadResponseWithSQLScoped!: IAskingService['adjustThreadResponseWithSQLScoped'];
  public adjustThreadResponseAnswerScoped!: IAskingService['adjustThreadResponseAnswerScoped'];
  public cancelAdjustThreadResponseAnswer!: IAskingService['cancelAdjustThreadResponseAnswer'];
  public rerunAdjustThreadResponseAnswer!: IAskingService['rerunAdjustThreadResponseAnswer'];
  public getAdjustmentTask!: IAskingService['getAdjustmentTask'];
  public getAdjustmentTaskById!: IAskingService['getAdjustmentTaskById'];
  public changeThreadResponseAnswerDetailStatusScoped!: IAskingService['changeThreadResponseAnswerDetailStatusScoped'];
  public previewDataScoped!: IAskingService['previewDataScoped'];
  public previewBreakdownDataScoped!: IAskingService['previewBreakdownDataScoped'];
  public createInstantRecommendedQuestions!: IAskingService['createInstantRecommendedQuestions'];
  public getInstantRecommendedQuestions!: IAskingService['getInstantRecommendedQuestions'];
  public generateThreadRecommendationQuestions!: IAskingService['generateThreadRecommendationQuestions'];
  public getThreadRecommendationQuestions!: IAskingService['getThreadRecommendationQuestions'];
  public deleteAllByProjectId!: IAskingService['deleteAllByProjectId'];

  public updateThread!: (
    threadId: number,
    input: Partial<AskingDetailTaskUpdateInput>,
  ) => Promise<any>;
  public deleteThread!: (threadId: number) => Promise<void>;
  public createThreadResponse!: (
    input: AskingDetailTaskInput,
    threadId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
  ) => Promise<any>;
  public updateThreadResponse!: (
    responseId: number,
    data: { sql: string },
  ) => Promise<any>;
  public generateThreadResponseBreakdown!: (
    threadResponseId: number,
    configurations: { language: string },
  ) => Promise<any>;
  public generateThreadResponseAnswer!: (
    threadResponseId: number,
    configurations?: { language: string },
  ) => Promise<any>;
  public generateThreadResponseChart!: (
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    configurations: { language: string },
    runtimeScopeId?: string | null,
  ) => Promise<any>;
  public adjustThreadResponseChart!: (
    threadResponseId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    input: any,
    configurations?: { language: string },
    runtimeScopeId?: string | null,
  ) => Promise<any>;
  public getResponsesWithThread!: (
    threadId: number,
    runtimeIdentity?: PersistedRuntimeIdentity,
  ) => Promise<any[]>;
  public getResponse!: (responseId: number) => Promise<any>;
  public previewData!: (
    responseId: number,
    limit?: number,
    fallbackRuntimeIdentity?: PersistedRuntimeIdentity | null,
  ) => Promise<PreviewDataResponse>;
  public previewBreakdownData!: (
    responseId: number,
    stepIndex?: number,
    limit?: number,
    fallbackRuntimeIdentity?: PersistedRuntimeIdentity | null,
  ) => Promise<PreviewDataResponse>;
  public changeThreadResponseAnswerDetailStatus!: (
    responseId: number,
    status: ThreadResponseAnswerStatus,
    content?: string,
  ) => Promise<any>;
  public adjustThreadResponseWithSQL!: (
    threadResponseId: number,
    input: AdjustmentSqlInput,
    fallbackRuntimeIdentity?: PersistedRuntimeIdentity | null,
  ) => Promise<any>;
  public adjustThreadResponseAnswer!: (
    threadResponseId: number,
    input: AdjustmentReasoningInput,
    configurations: { language: string },
    runtimeScopeId?: string | null,
  ) => Promise<any>;

  public getDeployId!: (
    runtimeIdentity: PersistedRuntimeIdentity,
  ) => Promise<any>;
  public getProjectAndDeployment!: (
    runtimeIdentity: PersistedRuntimeIdentity,
  ) => Promise<any>;
  public resolveScopedKnowledgeBaseIds!: (
    inputKnowledgeBaseIds?: string[] | null,
    thread?: any,
    runtimeIdentity?: PersistedRuntimeIdentity | null,
  ) => string[];
  public resolveRuntimeIdentityFromKnowledgeSelection!: (
    runtimeIdentity: PersistedRuntimeIdentity,
    knowledgeBaseIds: string[],
  ) => Promise<PersistedRuntimeIdentity>;
  public resolveScopedSelectedSkillIds!: (
    inputSelectedSkillIds?: string[] | null,
    thread?: any,
  ) => string[] | undefined;
  public resolveRetrievalScopeIds!: (
    knowledgeBaseIds: string[],
    runtimeIdentity: PersistedRuntimeIdentity,
  ) => Promise<string[]>;
  public resolveAskingRuntimeIdentity!: (
    payload: AskingPayload,
    threadRuntimeIdentity?: PersistedRuntimeIdentity | null,
  ) => PersistedRuntimeIdentity;
  public buildPersistedRuntimeIdentityPatch!: (
    runtimeIdentity: PersistedRuntimeIdentity,
  ) => PersistedRuntimeIdentity;
  public ensureTrackedAskingTaskPersisted!: (
    queryId: string,
    question: string,
    runtimeIdentity: PersistedRuntimeIdentity,
  ) => Promise<void>;
  public getThreadById!: (threadId: number) => Promise<any>;
  public getThreadRuntimeIdentity!: (
    threadId: number,
    fallbackRuntimeIdentity?: PersistedRuntimeIdentity | null,
  ) => Promise<PersistedRuntimeIdentity>;
  public getThreadResponseRuntimeIdentity!: (
    threadResponse: any,
    fallbackRuntimeIdentity?: PersistedRuntimeIdentity | null,
  ) => Promise<PersistedRuntimeIdentity>;
  public getExecutionResources!: (
    runtimeIdentity: PersistedRuntimeIdentity,
  ) => Promise<any>;
  public getAskingHistory!: (
    threadId: number,
    runtimeIdentity: PersistedRuntimeIdentity,
    excludeThreadResponseId?: number,
  ) => Promise<any[]>;
  public getThreadRecommendationQuestionsConfig!: (project: any) => any;
  public isLikelyNonChineseQuestions!: (
    questions: any[] | undefined | null,
  ) => boolean;
  public shouldForceChineseThreadRecommendation!: (
    thread: any,
  ) => Promise<boolean>;
  public trackInstantRecommendedQuestionTask!: (
    queryId: string,
    runtimeIdentity: PersistedRuntimeIdentity,
  ) => void;
  public assertInstantRecommendedQuestionTaskScope!: (
    queryId: string,
    runtimeIdentity: PersistedRuntimeIdentity,
  ) => void;
  public buildManifestBackedProject!: (deployment: any) => any;
  public mapManifestDataSourceToProjectType!: (dataSource: any) => any;
  public toAskRuntimeIdentity!: (
    runtimeIdentity?: PersistedRuntimeIdentity | null,
  ) => any;
  public buildAskTaskRuntimeIdentity!: (
    runtimeIdentity: PersistedRuntimeIdentity,
    deployHash?: string | null,
  ) => any;
  public normalizeRuntimeScope!: (
    runtimeIdentity?: PersistedRuntimeIdentity | null,
  ) => PersistedRuntimeIdentity | null;
  public resolveBreakdownBootstrapWorkspaceId!: () => Promise<string | null>;

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
}

applyAskingServiceActionPrototype(AskingService);
applyAskingServiceHelperPrototype(AskingService);

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
