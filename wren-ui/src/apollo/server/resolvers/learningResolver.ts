import { IContext } from '@server/types';
import { getConfig } from '@server/config';

import { getLogger } from '@server/utils';
import { uniq } from 'lodash';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  recordAuditEvent,
} from '@server/authz';

const config = getConfig();

const logger = getLogger('LearingResolver');
logger.level = 'debug';

const requireAuthorizationActor = (ctx: IContext) =>
  ctx.authorizationActor ||
  ctx.requestActor?.authorizationActor ||
  buildAuthorizationActorFromRuntimeScope(ctx.runtimeScope);

const getWorkspaceAuthorizationTarget = (ctx: IContext) => {
  const actor = requireAuthorizationActor(ctx);
  const workspaceId =
    ctx.runtimeScope?.workspace?.id ||
    ctx.requestActor?.workspaceId ||
    actor?.workspaceId ||
    null;

  if (!workspaceId) {
    throw new Error('Active workspace is required for this operation');
  }

  return {
    actor,
    resource: {
      resourceType: 'workspace' as const,
      resourceId: workspaceId,
      workspaceId,
      attributes: {
        workspaceKind: ctx.runtimeScope?.workspace?.kind || null,
      },
    },
  };
};

const requireLearningAccess = async (ctx: IContext) => {
  const { actor, resource } = getWorkspaceAuthorizationTarget(ctx);
  await assertAuthorizedWithAudit({
    auditEventRepository: ctx.auditEventRepository,
    actor,
    action: 'workspace.read',
    resource,
  });
  return { actor, resource };
};

export class LearningResolver {
  constructor() {
    this.getLearningRecord = this.getLearningRecord.bind(this);
    this.saveLearningRecord = this.saveLearningRecord.bind(this);
  }

  public async getLearningRecord(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<any> {
    const { actor, resource } = await requireLearningAccess(ctx);
    const result = await ctx.learningRepository.findAllBy({
      userId: this.getActiveLearningUserId(ctx),
    });
    await recordAuditEvent({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'workspace.read',
      resource,
      result: 'allowed',
      payloadJson: {
        operation: 'get_learning_record',
      },
    });
    return { paths: result[0]?.paths || [] };
  }

  public async saveLearningRecord(
    _root: any,
    args: any,
    ctx: IContext,
  ): Promise<any> {
    const { actor, resource } = await requireLearningAccess(ctx);
    const { path } = args.data;
    const userId = this.getActiveLearningUserId(ctx);
    const result = await ctx.learningRepository.findAllBy({ userId });

    const saved = !result.length
      ? await ctx.learningRepository.createOne({
          userId,
          paths: [path],
        })
      : await ctx.learningRepository.updateOne(result[0].id, {
          userId,
          paths: uniq([...result[0].paths, path]),
        });

    await recordAuditEvent({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'workspace.read',
      resource,
      result: 'allowed',
      payloadJson: {
        operation: 'save_learning_record',
      },
    });

    return saved;
  }

  private getActiveLearningUserId(ctx: IContext) {
    return (
      ctx.runtimeScope?.userId || ctx.requestActor?.userId || config?.userUUID
    );
  }
}
