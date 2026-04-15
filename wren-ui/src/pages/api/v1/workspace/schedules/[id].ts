import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { toPersistedRuntimeIdentity } from '@server/context/runtimeScope';
import { getSessionTokenFromRequest } from '@server/context/actorClaims';
import { resolveDashboardScheduleBinding } from '@server/utils/dashboardRuntime';
import {
  ScheduleFrequencyEnum,
  SetDashboardCacheData,
} from '@server/models/dashboard';
import { DASHBOARD_REFRESH_TARGET_TYPE } from '@server/services/scheduleService';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromValidatedSession,
  buildAuthorizationContextFromRequest,
  recordAuditEvent,
} from '@server/authz';

const readQueryValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const serializeScheduleJob = (job: any) => ({
  id: job.id,
  workspaceId: job.workspaceId,
  knowledgeBaseId: job.knowledgeBaseId,
  kbSnapshotId: job.kbSnapshotId,
  deployHash: job.deployHash,
  targetType: job.targetType,
  targetId: job.targetId,
  cronExpr: job.cronExpr,
  timezone: job.timezone,
  status: job.status,
  nextRunAt: job.nextRunAt || null,
  lastRunAt: job.lastRunAt || null,
  lastError: job.lastError || null,
});

const serializeDashboard = (dashboard: any) => ({
  id: dashboard.id,
  cacheEnabled: dashboard.cacheEnabled,
  scheduleFrequency: dashboard.scheduleFrequency,
  scheduleTimezone: dashboard.scheduleTimezone,
  scheduleCron: dashboard.scheduleCron,
  nextScheduledAt: dashboard.nextScheduledAt || null,
});

const ensureScopedScheduleJob = async (req: NextApiRequest, id: string) => {
  const runtimeScope =
    await components.runtimeScopeResolver.resolveRequestScope(req);
  const workspace = runtimeScope.workspace;
  if (!workspace) {
    throw new Error('Workspace scope is required');
  }

  const scheduleJob = await components.scheduleJobRepository.findOneBy({ id });
  if (!scheduleJob || scheduleJob.workspaceId !== workspace.id) {
    throw new Error('Schedule job not found');
  }

  if (
    runtimeScope.knowledgeBase &&
    scheduleJob.knowledgeBaseId !== runtimeScope.knowledgeBase.id
  ) {
    throw new Error('Schedule job not found');
  }

  return {
    runtimeScope,
    scheduleJob,
  };
};

const ensureManagerPermission = async (
  req: NextApiRequest,
  workspaceId: string,
) => {
  const sessionToken = getSessionTokenFromRequest(req);
  if (!sessionToken) {
    throw new Error('Authentication required');
  }

  const validatedSession = await components.authService.validateSession(
    sessionToken,
    workspaceId,
  );
  if (!validatedSession) {
    throw new Error('Authentication required');
  }

  return validatedSession;
};

const syncDashboardScheduleJob = async ({
  runtimeScope,
  scheduleJob,
  data,
}: {
  runtimeScope: Awaited<
    ReturnType<typeof components.runtimeScopeResolver.resolveRequestScope>
  >;
  scheduleJob: Awaited<
    ReturnType<typeof components.scheduleJobRepository.findOneBy>
  >;
  data: SetDashboardCacheData;
}) => {
  if (!scheduleJob) {
    throw new Error('Schedule job not found');
  }

  if (scheduleJob.targetType !== DASHBOARD_REFRESH_TARGET_TYPE) {
    throw new Error('Only dashboard refresh jobs can be updated here');
  }

  const dashboardId = Number.parseInt(scheduleJob.targetId, 10);
  if (Number.isNaN(dashboardId)) {
    throw new Error(
      `Invalid dashboard refresh target id: ${scheduleJob.targetId}`,
    );
  }

  const dashboard = await components.dashboardRepository.findOneBy({
    id: dashboardId,
  });
  if (!dashboard) {
    throw new Error('Dashboard not found');
  }

  const updatedDashboard =
    await components.dashboardService.setDashboardSchedule(dashboardId, data);

  const runtimeIdentity = toPersistedRuntimeIdentity(runtimeScope);
  const scheduleBinding = await resolveDashboardScheduleBinding({
    dashboard: updatedDashboard,
    runtimeIdentity,
    kbSnapshotRepository: components.kbSnapshotRepository,
    knowledgeBaseRepository: components.knowledgeBaseRepository,
  });

  const syncedJob = await components.scheduleService.syncDashboardRefreshJob({
    dashboardId: updatedDashboard.id,
    enabled: Boolean(
      updatedDashboard.cacheEnabled && updatedDashboard.scheduleCron,
    ),
    cronExpr: updatedDashboard.scheduleCron,
    timezone:
      updatedDashboard.scheduleTimezone || scheduleJob.timezone || 'UTC',
    nextRunAt: updatedDashboard.nextScheduledAt || null,
    workspaceId: scheduleBinding.workspaceId,
    knowledgeBaseId: scheduleBinding.knowledgeBaseId,
    kbSnapshotId: scheduleBinding.kbSnapshotId,
    deployHash: scheduleBinding.deployHash,
    createdBy: runtimeIdentity.actorUserId || null,
  });

  return {
    dashboard: serializeDashboard(updatedDashboard),
    job: serializeScheduleJob(syncedJob || scheduleJob),
  };
};

const disableDashboardScheduleJob = async ({
  runtimeScope,
  scheduleJob,
}: {
  runtimeScope: Awaited<
    ReturnType<typeof components.runtimeScopeResolver.resolveRequestScope>
  >;
  scheduleJob: Awaited<
    ReturnType<typeof components.scheduleJobRepository.findOneBy>
  >;
}) =>
  await syncDashboardScheduleJob({
    runtimeScope,
    scheduleJob,
    data: {
      cacheEnabled: true,
      schedule: {
        frequency: ScheduleFrequencyEnum.NEVER,
        day: null as any,
        hour: 0,
        minute: 0,
        cron: null as any,
        timezone: scheduleJob?.timezone || 'UTC',
      },
    },
  });

const updateDashboardScheduleJob = async ({
  runtimeScope,
  scheduleJob,
  body,
}: {
  runtimeScope: Awaited<
    ReturnType<typeof components.runtimeScopeResolver.resolveRequestScope>
  >;
  scheduleJob: Awaited<
    ReturnType<typeof components.scheduleJobRepository.findOneBy>
  >;
  body: Record<string, any>;
}) => {
  const data = body?.data as SetDashboardCacheData | undefined;
  if (!data || typeof data.cacheEnabled !== 'boolean') {
    throw new Error('Schedule update payload is required');
  }

  if (data.cacheEnabled && !data.schedule) {
    throw new Error('Schedule config is required when cache is enabled');
  }

  return await syncDashboardScheduleJob({
    runtimeScope,
    scheduleJob,
    data,
  });
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', 'PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const id = readQueryValue(req.query.id);
    if (!id) {
      return res.status(400).json({ error: 'Schedule job id is required' });
    }

    const action = `${req.body?.action || ''}`.trim();
    if (!action) {
      return res.status(400).json({ error: 'Schedule action is required' });
    }

    if (!['disable', 'update'].includes(action)) {
      return res.status(400).json({ error: 'Unsupported schedule action' });
    }

    const scopedJob = await ensureScopedScheduleJob(req, id);
    const scopedWorkspace = scopedJob.runtimeScope.workspace;
    if (!scopedWorkspace) {
      throw new Error('Workspace scope is required');
    }
    const validatedSession = await ensureManagerPermission(
      req,
      scopedWorkspace.id,
    );
    const actor = buildAuthorizationActorFromValidatedSession(validatedSession);
    const auditContext = buildAuthorizationContextFromRequest({
      req,
      sessionId: actor.sessionId,
      runtimeScope: scopedJob.runtimeScope,
    });
    const authorizationResource = {
      resourceType: 'schedule_job',
      resourceId: scopedJob.scheduleJob?.id || id,
      workspaceId: scopedWorkspace.id,
    };
    await assertAuthorizedWithAudit({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'workspace.schedule.manage',
      resource: authorizationResource,
      context: auditContext,
    });
    const beforeJob = serializeScheduleJob(scopedJob.scheduleJob);
    const payload =
      action === 'disable'
        ? await disableDashboardScheduleJob(scopedJob)
        : await updateDashboardScheduleJob({
            ...scopedJob,
            body: req.body || {},
          });
    await recordAuditEvent({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'workspace.schedule.manage',
      resource: authorizationResource,
      result: 'succeeded',
      context: auditContext,
      beforeJson: beforeJob as any,
      afterJson: payload.job as any,
      payloadJson: {
        action,
      },
    });
    return res.status(200).json(payload);
  } catch (error: any) {
    const message =
      error?.message === 'Schedule job not found'
        ? 'Schedule job not found'
        : error?.message || 'Failed to update schedule job';
    const statusCode =
      error?.statusCode ||
      (message === 'Schedule job not found'
        ? 404
        : message === 'Authentication required'
          ? 401
          : message === 'Workspace manager permission required'
            ? 403
            : 400);
    return res.status(statusCode).json({ error: message });
  }
}
