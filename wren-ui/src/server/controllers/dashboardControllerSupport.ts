import { IContext } from '@server/types';
import { Dashboard, DashboardItem, KnowledgeBase } from '@server/repositories';
import * as Errors from '@server/utils/error';
import {
  OUTDATED_RUNTIME_SNAPSHOT_MESSAGE,
  assertLatestExecutableRuntimeScope,
} from '@server/utils/runtimeExecutionContext';
import { toPersistedRuntimeIdentity } from '@server/context/runtimeScope';
import {
  normalizeCanonicalPersistedRuntimeIdentity,
  resolvePersistedProjectBridgeId,
} from '@server/utils/persistedRuntimeIdentity';
import {
  getDashboardRuntimeBinding,
  resolveDashboardScheduleBinding,
} from '@server/utils/dashboardRuntime';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  recordAuditEvent,
} from '@server/authz';
import { PreviewItemResponse } from '@server/models/dashboard';

export const getDashboardControllerErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const getCurrentPersistedRuntimeIdentity = (ctx: IContext) =>
  normalizeCanonicalPersistedRuntimeIdentity(
    toPersistedRuntimeIdentity(ctx.runtimeScope!),
  );

export const getCurrentPersistedWorkspaceIdentity = (ctx: IContext) => {
  const runtimeIdentity = getCurrentPersistedRuntimeIdentity(ctx);

  return {
    projectId: null,
    workspaceId: runtimeIdentity.workspaceId || ctx.runtimeScope?.workspace?.id,
    knowledgeBaseId: null,
    kbSnapshotId: null,
    deployHash: null,
    actorUserId: runtimeIdentity.actorUserId || null,
  };
};

export const shouldUseWorkspaceScopedDashboardCreate = (ctx: IContext) => {
  const selector = ctx.runtimeScope?.selector;
  if (!selector) {
    return false;
  }

  return !(
    selector.knowledgeBaseId ||
    selector.kbSnapshotId ||
    selector.deployHash
  );
};

export const getCurrentPersistedDashboardScopeIdentity = (ctx: IContext) =>
  shouldUseWorkspaceScopedDashboardCreate(ctx)
    ? getCurrentPersistedWorkspaceIdentity(ctx)
    : getCurrentPersistedRuntimeIdentity(ctx);

export const getDashboardWorkspaceBinding = (ctx: IContext) =>
  getDashboardRuntimeBinding(getCurrentPersistedWorkspaceIdentity(ctx));

export const ensureDashboardForWorkspaceScope = async (
  ctx: IContext,
  dashboardId: number,
): Promise<Dashboard> => {
  const runtimeIdentity = getCurrentPersistedWorkspaceIdentity(ctx);
  const dashboard = await ctx.dashboardService.getDashboardForScope(
    dashboardId,
    resolvePersistedProjectBridgeId(runtimeIdentity),
    getDashboardRuntimeBinding(runtimeIdentity),
  );

  if (!dashboard) {
    throw new Error('Dashboard not found.');
  }

  return dashboard;
};

export const ensureCurrentDashboardForScope = async (
  ctx: IContext,
  dashboardId?: number | null,
): Promise<Dashboard> => {
  const runtimeIdentity = getCurrentPersistedRuntimeIdentity(ctx);
  const resolvedProjectBridgeId =
    resolvePersistedProjectBridgeId(runtimeIdentity);
  const binding = getDashboardRuntimeBinding(runtimeIdentity);
  const dashboard =
    dashboardId != null
      ? await ctx.dashboardService.getDashboardForScope(
          dashboardId,
          resolvedProjectBridgeId,
          binding,
        )
      : await ctx.dashboardService.getCurrentDashboardForScope(
          resolvedProjectBridgeId,
          binding,
        );

  if (!dashboard) {
    throw new Error('Dashboard not found.');
  }

  return dashboard;
};

export const ensureCurrentDashboardForRequestedScope = async (
  ctx: IContext,
  dashboardId?: number | null,
): Promise<Dashboard> => {
  const runtimeIdentity = getCurrentPersistedDashboardScopeIdentity(ctx);
  const resolvedProjectBridgeId =
    resolvePersistedProjectBridgeId(runtimeIdentity);
  const binding = getDashboardRuntimeBinding(runtimeIdentity);
  const dashboard =
    dashboardId != null
      ? await ctx.dashboardService.getDashboardForScope(
          dashboardId,
          resolvedProjectBridgeId,
          binding,
        )
      : await ctx.dashboardService.getCurrentDashboardForScope(
          resolvedProjectBridgeId,
          binding,
        );

  if (!dashboard) {
    throw new Error('Dashboard not found.');
  }

  return dashboard;
};

export const ensureDashboardItemInScope = async (
  ctx: IContext,
  itemId: number,
): Promise<{ dashboard: Dashboard; item: DashboardItem }> => {
  const item = await ctx.dashboardService.getDashboardItem(itemId);
  if (!item) {
    throw new Error(`Dashboard item not found. id: ${itemId}`);
  }

  try {
    const dashboard = await ensureDashboardForWorkspaceScope(
      ctx,
      item.dashboardId,
    );

    return { dashboard, item };
  } catch (_error) {
    throw new Error(`Dashboard item not found. id: ${itemId}`);
  }
};

export const assertDashboardExecutableRuntimeScope = async (ctx: IContext) => {
  try {
    await assertLatestExecutableRuntimeScope({
      runtimeScope: ctx.runtimeScope!,
      knowledgeBaseRepository: ctx.knowledgeBaseRepository,
      kbSnapshotRepository: ctx.kbSnapshotRepository,
    });
  } catch (error) {
    throw Errors.create(Errors.GeneralErrorCodes.OUTDATED_RUNTIME_SNAPSHOT, {
      customMessage:
        error instanceof Error
          ? error.message
          : OUTDATED_RUNTIME_SNAPSHOT_MESSAGE,
    });
  }
};

const getKnowledgeBaseReadAuthorizationTarget = (ctx: IContext) => {
  const workspaceId = ctx.runtimeScope?.workspace?.id || null;
  const knowledgeBase = ctx.runtimeScope?.knowledgeBase as KnowledgeBase | null;

  return {
    actor:
      ctx.authorizationActor ||
      buildAuthorizationActorFromRuntimeScope(ctx.runtimeScope),
    resource: {
      resourceType: knowledgeBase ? 'knowledge_base' : 'workspace',
      resourceId: knowledgeBase?.id || workspaceId,
      workspaceId,
      attributes: {
        workspaceKind: ctx.runtimeScope?.workspace?.kind || null,
        knowledgeBaseKind: knowledgeBase?.kind || null,
      },
    },
  };
};

export const assertDashboardKnowledgeBaseReadAccess = async (ctx: IContext) => {
  const { actor, resource } = getKnowledgeBaseReadAuthorizationTarget(ctx);
  await assertAuthorizedWithAudit({
    auditEventRepository: ctx.auditEventRepository,
    actor,
    action: 'knowledge_base.read',
    resource,
  });
};

export const recordDashboardKnowledgeBaseReadAudit = async (
  ctx: IContext,
  {
    resourceType,
    resourceId,
    payloadJson,
  }: {
    resourceType?: string;
    resourceId?: string | number | null;
    payloadJson?: Record<string, any> | null;
  },
) => {
  const { actor, resource } = getKnowledgeBaseReadAuthorizationTarget(ctx);
  await recordAuditEvent({
    auditEventRepository: ctx.auditEventRepository,
    actor,
    action: 'knowledge_base.read',
    resource: {
      ...resource,
      resourceType: resourceType || resource.resourceType,
      resourceId: resourceId ?? resource.resourceId ?? null,
    },
    result: 'allowed',
    payloadJson: payloadJson || undefined,
  });
};

export const toDashboardResponseRuntimeIdentitySource = (response: {
  projectId?: number | null;
  deployHash?: string | null;
}) => ({
  projectId: response.projectId ?? null,
  deployHash: response.deployHash ?? null,
});

export const resolveDashboardScheduleRuntimeBinding = async (
  ctx: IContext,
  dashboard: Dashboard,
  runtimeIdentity = getCurrentPersistedRuntimeIdentity(ctx),
) =>
  resolveDashboardScheduleBinding({
    dashboard,
    runtimeIdentity,
    kbSnapshotRepository: ctx.kbSnapshotRepository,
    knowledgeBaseRepository: ctx.knowledgeBaseRepository,
  });

export const toDashboardPreviewItemResponse = ({
  item,
  previewData,
  chartDataProfile,
}: {
  item: DashboardItem;
  previewData: {
    columns: Array<{ name: string }>;
    data: unknown[][];
    cacheHit?: boolean | null;
    cacheCreatedAt?: string | null;
    cacheOverrodeAt?: string | null;
    override?: boolean | null;
  };
  chartDataProfile?: DashboardItem['detail']['chartDataProfile'] | null;
}): PreviewItemResponse => {
  const data = previewData.data.map((row) =>
    previewData.columns.reduce<Record<string, unknown>>((acc, col, index) => {
      acc[col.name] = row[index];
      return acc;
    }, {}),
  );

  return {
    chartDataProfile: chartDataProfile || item.detail.chartDataProfile || null,
    cacheHit: previewData.cacheHit || false,
    cacheCreatedAt: previewData.cacheCreatedAt || null,
    cacheOverrodeAt: previewData.cacheOverrodeAt || null,
    override: previewData.override || false,
    data,
  };
};
