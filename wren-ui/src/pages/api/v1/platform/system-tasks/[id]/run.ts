import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { assertAuthorizedWithAudit, recordAuditEvent } from '@server/authz';
import {
  runScheduleJobNow,
  serializeScheduleJob,
  serializeScheduleRun,
} from '@server/api/workspace/scheduleActionSupport';
import {
  assertPlatformActionForContext,
  createHttpError,
  getString,
  requireWorkspaceScopedContext,
} from '@server/api/platform/platformApiUtils';

const resolveScheduleJob = async ({
  id,
  workspaceId,
}: {
  id: string;
  workspaceId?: string | null;
}) => {
  const scheduleJob = await components.scheduleJobRepository.findOneBy({ id });
  if (!scheduleJob) {
    throw createHttpError(404, 'Schedule job not found');
  }
  if (workspaceId && scheduleJob.workspaceId !== workspaceId) {
    throw createHttpError(404, 'Schedule job not found');
  }
  return scheduleJob;
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
    const id = getString(req.query.id);
    if (!id) {
      throw createHttpError(400, 'Schedule job id is required');
    }

    const requestedWorkspaceId = getString(req.query.workspaceId) || null;
    const scheduleJob = await resolveScheduleJob({
      id,
      workspaceId: requestedWorkspaceId,
    });
    const context = await requireWorkspaceScopedContext({
      req,
      workspaceId: scheduleJob.workspaceId,
      platformAction: 'platform.system_task.manage',
    });

    const auditResource = {
      resourceType: 'schedule_job',
      resourceId: scheduleJob.id,
      workspaceId: scheduleJob.workspaceId,
      attributes: {
        workspaceKind: context.workspace.kind || null,
        targetType: scheduleJob.targetType,
        targetId: scheduleJob.targetId,
      },
    };

    if (context.hasPlatformAccess) {
      await assertPlatformActionForContext({
        context,
        action: 'platform.system_task.manage',
        resource: auditResource,
      });
    } else {
      await assertAuthorizedWithAudit({
        auditEventRepository: components.auditEventRepository,
        actor: context.scopedActor,
        action: 'workspace.schedule.manage',
        resource: auditResource,
        context: context.auditContext,
      });
    }

    const beforeJob = serializeScheduleJob(scheduleJob);
    const { updatedJob, latestRun } = await runScheduleJobNow({
      id,
      scheduleJob,
    });

    if (latestRun?.status === 'failed') {
      await recordAuditEvent({
        auditEventRepository: components.auditEventRepository,
        actor: context.hasPlatformAccess ? context.actor : context.scopedActor,
        action: context.hasPlatformAccess
          ? 'platform.system_task.manage'
          : 'workspace.schedule.manage',
        resource: auditResource,
        result: 'failed',
        context: context.auditContext,
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
      actor: context.hasPlatformAccess ? context.actor : context.scopedActor,
      action: context.hasPlatformAccess
        ? 'platform.system_task.manage'
        : 'workspace.schedule.manage',
      resource: auditResource,
      result: 'succeeded',
      context: context.auditContext,
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
    return res.status(error?.statusCode || 400).json({
      error: error?.message || 'Failed to run platform system task',
    });
  }
}
