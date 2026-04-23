import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { toPersistedRuntimeIdentity } from '@server/context/runtimeScope';
import { getSessionTokenFromRequest } from '@server/context/actorClaims';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromValidatedSession,
  buildAuthorizationContextFromRequest,
  recordAuditEvent,
} from '@server/authz';
import {
  disableDashboardScheduleJob,
  serializeScheduleJob,
  updateDashboardScheduleJob,
} from '@server/api/workspace/scheduleActionSupport';

const readQueryValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

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
    const runtimeIdentity = toPersistedRuntimeIdentity(scopedJob.runtimeScope);
    const payload =
      action === 'disable'
        ? await disableDashboardScheduleJob({
            runtimeIdentity,
            scheduleJob: scopedJob.scheduleJob,
          })
        : await updateDashboardScheduleJob({
            runtimeIdentity,
            scheduleJob: scopedJob.scheduleJob,
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
