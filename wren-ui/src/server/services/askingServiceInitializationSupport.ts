import { resolveBreakdownBootstrapWorkspaceId } from './askingServiceRuntimeSupport';
import { logger } from './askingServiceShared';

interface AskingInitializationServiceLike {
  askingTaskRepository: Pick<any, 'findUnfinishedTasks'>;
  askingTaskTracker?: Pick<any, 'rehydrateTrackedTask'>;
  threadResponseRepository: Pick<
    any,
    | 'findUnfinishedBreakdownResponsesByWorkspaceId'
    | 'findUnfinishedBreakdownResponses'
    | 'findUnfinishedAnswerResponses'
    | 'findUnfinishedChartResponses'
  >;
  breakdownBackgroundTracker: Pick<any, 'addTask'>;
  textBasedAnswerBackgroundTracker?: Pick<any, 'addTask'>;
  chartBackgroundTracker: Pick<any, 'addTask'>;
  chartAdjustmentBackgroundTracker: Pick<any, 'addTask'>;
  resolveBreakdownBootstrapWorkspaceId(): Promise<string | null>;
}

export const initializeAskingService = async (
  service: AskingInitializationServiceLike,
) => {
  const bootstrapWorkspaceId =
    await service.resolveBreakdownBootstrapWorkspaceId();
  const scopeLabel = bootstrapWorkspaceId
    ? `workspace ${bootstrapWorkspaceId}`
    : 'all workspaces';

  const unfininshedBreakdownThreadResponses = bootstrapWorkspaceId
    ? await service.threadResponseRepository.findUnfinishedBreakdownResponsesByWorkspaceId(
        bootstrapWorkspaceId,
      )
    : await service.threadResponseRepository.findUnfinishedBreakdownResponses();
  logger.info(
    `Initialization: adding unfininshed breakdown thread responses for ${scopeLabel} (total: ${unfininshedBreakdownThreadResponses.length}) to background tracker`,
  );
  for (const threadResponse of unfininshedBreakdownThreadResponses) {
    service.breakdownBackgroundTracker.addTask(threadResponse);
  }

  const unfinishedAnswerResponses =
    (await service.threadResponseRepository.findUnfinishedAnswerResponses?.()) ||
    [];
  logger.info(
    `Initialization: adding unfinished text-answer thread responses for all workspaces (total: ${unfinishedAnswerResponses.length}) to background tracker`,
  );
  for (const threadResponse of unfinishedAnswerResponses) {
    service.textBasedAnswerBackgroundTracker?.addTask(threadResponse);
  }

  const unfinishedAskingTasks =
    (await service.askingTaskRepository.findUnfinishedTasks?.()) || [];
  logger.info(
    `Initialization: rehydrating unfinished asking tasks (total: ${unfinishedAskingTasks.length}) into tracker`,
  );
  for (const task of unfinishedAskingTasks) {
    service.askingTaskTracker?.rehydrateTrackedTask?.(task);
  }

  const unfinishedChartResponses =
    await service.threadResponseRepository.findUnfinishedChartResponses({
      adjustment: false,
    });
  logger.info(
    `Initialization: adding unfinished chart thread responses for all workspaces (total: ${unfinishedChartResponses.length}) to background tracker`,
  );
  for (const threadResponse of unfinishedChartResponses) {
    service.chartBackgroundTracker.addTask(threadResponse);
  }

  const unfinishedChartAdjustmentResponses =
    await service.threadResponseRepository.findUnfinishedChartResponses({
      adjustment: true,
    });
  logger.info(
    `Initialization: adding unfinished chart adjustment thread responses for all workspaces (total: ${unfinishedChartAdjustmentResponses.length}) to background tracker`,
  );
  for (const threadResponse of unfinishedChartAdjustmentResponses) {
    service.chartAdjustmentBackgroundTracker.addTask(threadResponse);
  }
};

export { resolveBreakdownBootstrapWorkspaceId };
