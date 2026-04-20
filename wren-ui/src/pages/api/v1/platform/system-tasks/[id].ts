import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { toPersistedRuntimeIdentityFromSource } from '@server/utils/persistedRuntimeIdentity';
import {
  assertAuthorizedWithAudit,
  recordAuditEvent,
} from '@server/authz';
import {
  disableDashboardScheduleJob,
  serializeScheduleJob,
  updateDashboardScheduleJob,
} from '../../workspace/scheduleActionSupport';
import {
  assertPlatformActionForContext,
  createHttpError,
  getString,
  requireWorkspaceScopedContext,
} from '../platformApiUtils';

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
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', 'PATCH');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const id = getString(req.query.id);
    if (!id) {
      throw createHttpError(400, 'Schedule job id is required');
    }

    const operation = getString(req.body?.action);
    if (!operation) {
      throw createHttpError(400, 'Schedule action is required');
    }
    if (!['disable', 'update'].includes(operation)) {
      throw createHttpError(400, 'Unsupported schedule action');
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

    const runtimeIdentity = toPersistedRuntimeIdentityFromSource({
      workspaceId: scheduleJob.workspaceId,
      knowledgeBaseId: scheduleJob.knowledgeBaseId || null,
      kbSnapshotId: scheduleJob.kbSnapshotId || null,
      deployHash: scheduleJob.deployHash || null,
      actorUserId: context.hasPlatformAccess
        ? context.actor.principalId
        : context.scopedActor.principalId,
    });
    const beforeJob = serializeScheduleJob(scheduleJob);
    const payload =
      operation === 'disable'
        ? await disableDashboardScheduleJob({
            runtimeIdentity,
            scheduleJob,
          })
        : await updateDashboardScheduleJob({
            runtimeIdentity,
            scheduleJob,
            body: req.body || {},
          });

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
      afterJson: payload.job as any,
      payloadJson: {
        action: operation,
      },
    });

    return res.status(200).json(payload);
  } catch (error: any) {
    return res.status(error?.statusCode || 400).json({
      error: error?.message || 'Failed to update platform system task',
    });
  }
}
