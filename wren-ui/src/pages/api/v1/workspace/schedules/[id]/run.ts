import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { getSessionTokenFromRequest } from '@server/context/actorClaims';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromValidatedSession,
  buildAuthorizationContextFromRequest,
  recordAuditEvent,
} from '@server/authz';
import {
  runScheduleJobNow,
  serializeScheduleJob,
  serializeScheduleRun,
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

  if (
    runtimeScope.knowledgeBase &&
    scheduleJob.knowledgeBaseId !== runtimeScope.knowledgeBase.id
  ) {
    throw new Error('Schedule job not found');
  }

  return scheduleJob;
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
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const id = readQueryValue(req.query.id);
    if (!id) {
      return res.status(400).json({ error: 'Schedule job id is required' });
    }

    const scheduleJob = await ensureScopedScheduleJob(req, id);
    const validatedSession = await ensureManagerPermission(
      req,
      scheduleJob.workspaceId,
    );
    const actor = buildAuthorizationActorFromValidatedSession(validatedSession);
    const auditContext = buildAuthorizationContextFromRequest({
      req,
      sessionId: actor.sessionId,
    });
    const auditResource = {
      resourceType: 'schedule_job',
      resourceId: scheduleJob.id,
      workspaceId: scheduleJob.workspaceId,
    };
    await assertAuthorizedWithAudit({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'workspace.schedule.manage',
      resource: auditResource,
      context: auditContext,
    });
    const beforeJob = serializeScheduleJob(scheduleJob);
    const { updatedJob, latestRun } = await runScheduleJobNow({
      id,
      scheduleJob,
    });

    if (latestRun?.status === 'failed') {
      await recordAuditEvent({
        auditEventRepository: components.auditEventRepository,
        actor,
        action: 'workspace.schedule.manage',
        resource: auditResource,
        result: 'failed',
        context: auditContext,
        beforeJson: beforeJob as any,
        afterJson: updatedJob
          ? (serializeScheduleJob(updatedJob) as any)
          : null,
        payloadJson: {
          operation: 'run_now',
          lastRun: latestRun,
        },
      });
      return res.status(500).json({
        error: latestRun.errorMessage || 'Schedule job execution failed',
        job: updatedJob ? serializeScheduleJob(updatedJob) : null,
        lastRun: serializeScheduleRun(latestRun),
      });
    }

    await recordAuditEvent({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'workspace.schedule.manage',
      resource: auditResource,
      result: 'succeeded',
      context: auditContext,
      beforeJson: beforeJob as any,
      afterJson: updatedJob ? (serializeScheduleJob(updatedJob) as any) : null,
      payloadJson: {
        operation: 'run_now',
        lastRun: latestRun ? serializeScheduleRun(latestRun) : null,
      },
    });

    return res.status(200).json({
      job: updatedJob
        ? serializeScheduleJob(updatedJob)
        : serializeScheduleJob(scheduleJob),
      lastRun: latestRun ? serializeScheduleRun(latestRun) : null,
    });
  } catch (error: any) {
    const message =
      error?.message === 'Schedule job not found'
        ? 'Schedule job not found'
        : error?.message || 'Failed to run schedule job';
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
