import { IContext } from '@server/types';
import { UpdateInstructionInput } from '@server/models';
import { Instruction } from '@server/repositories/instructionRepository';
import { toPersistedRuntimeIdentity } from '@server/context/runtimeScope';
import { getLogger } from '@server/utils';
import * as Errors from '@server/utils/error';
import { assertLatestExecutableRuntimeScope } from '@server/utils/runtimeExecutionContext';
import { TelemetryEvent, TrackTelemetry } from '@server/telemetry/telemetry';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  recordAuditEvent,
} from '@server/authz';

const logger = getLogger('InstructionResolver');
logger.level = 'debug';

const requireKnowledgeBaseWriteAccess = async (ctx: IContext) => {
  const { actor, resource } = getKnowledgeBaseAuthorizationTarget(ctx);
  await assertAuthorizedWithAudit({
    auditEventRepository: ctx.auditEventRepository,
    actor,
    action: 'knowledge_base.update',
    resource,
  });
};

const requireKnowledgeBaseReadAccess = async (ctx: IContext) => {
  const { actor, resource } = getKnowledgeBaseAuthorizationTarget(ctx);
  await assertAuthorizedWithAudit({
    auditEventRepository: ctx.auditEventRepository,
    actor,
    action: 'knowledge_base.read',
    resource,
  });
  return { actor, resource };
};

const getKnowledgeBaseAuthorizationTarget = (ctx: IContext) => {
  const workspaceId = ctx.runtimeScope?.workspace?.id || null;
  const knowledgeBase = ctx.runtimeScope?.knowledgeBase;

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

export class InstructionResolver {
  constructor() {
    this.getInstructions = this.getInstructions.bind(this);
    this.createInstruction = this.createInstruction.bind(this);
    this.updateInstruction = this.updateInstruction.bind(this);
    this.deleteInstruction = this.deleteInstruction.bind(this);
  }

  public async getInstructions(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<Instruction[]> {
    try {
      const { actor, resource } = await requireKnowledgeBaseReadAccess(ctx);
      const instructions = await ctx.instructionService.listInstructions(
        toPersistedRuntimeIdentity(ctx.runtimeScope!),
      );
      await recordAuditEvent({
        auditEventRepository: ctx.auditEventRepository,
        actor,
        action: 'knowledge_base.read',
        resource,
        result: 'allowed',
        payloadJson: {
          operation: 'get_instructions',
        },
      });
      return instructions;
    } catch (error) {
      logger.error(`Error getting instructions: ${error}`);
      throw error;
    }
  }

  @TrackTelemetry(TelemetryEvent.KNOWLEDGE_CREATE_INSTRUCTION)
  public async createInstruction(
    _root: any,
    args: {
      data: {
        instruction: string;
        questions: string[];
        isDefault: boolean;
      };
    },
    ctx: IContext,
  ): Promise<Instruction> {
    await this.assertExecutableRuntimeScope(ctx);
    await requireKnowledgeBaseWriteAccess(ctx);
    const { instruction, questions, isDefault } = args.data;
    const created = await ctx.instructionService.createInstruction(
      toPersistedRuntimeIdentity(ctx.runtimeScope!),
      {
        instruction,
        questions,
        isDefault,
      },
    );
    const { actor, resource } = getKnowledgeBaseAuthorizationTarget(ctx);
    await recordAuditEvent({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'knowledge_base.update',
      resource: {
        ...resource,
        resourceType: 'instruction',
        resourceId: created.id,
      },
      result: 'succeeded',
      afterJson: created as any,
      payloadJson: {
        operation: 'create_instruction',
      },
    });
    return created;
  }

  @TrackTelemetry(TelemetryEvent.KNOWLEDGE_UPDATE_INSTRUCTION)
  public async updateInstruction(
    _root: any,
    args: {
      data: Pick<
        UpdateInstructionInput,
        'instruction' | 'questions' | 'isDefault'
      >;
      where: { id: number };
    },
    ctx: IContext,
  ): Promise<Instruction> {
    await this.assertExecutableRuntimeScope(ctx);
    await requireKnowledgeBaseWriteAccess(ctx);
    const { id } = args.where;
    const { instruction, questions, isDefault } = args.data;
    if (!id) {
      throw new Error('Instruction ID is required.');
    }
    const updated = await ctx.instructionService.updateInstruction(
      toPersistedRuntimeIdentity(ctx.runtimeScope!),
      {
        id,
        instruction,
        questions,
        isDefault,
      },
    );
    const { actor, resource } = getKnowledgeBaseAuthorizationTarget(ctx);
    await recordAuditEvent({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'knowledge_base.update',
      resource: {
        ...resource,
        resourceType: 'instruction',
        resourceId: id,
      },
      result: 'succeeded',
      afterJson: updated as any,
      payloadJson: {
        operation: 'update_instruction',
      },
    });
    return updated;
  }

  @TrackTelemetry(TelemetryEvent.KNOWLEDGE_DELETE_INSTRUCTION)
  public async deleteInstruction(
    _root: any,
    args: { where: { id: number } },
    ctx: IContext,
  ): Promise<boolean> {
    await this.assertExecutableRuntimeScope(ctx);
    await requireKnowledgeBaseWriteAccess(ctx);
    const { id } = args.where;
    await ctx.instructionService.deleteInstruction(
      id,
      toPersistedRuntimeIdentity(ctx.runtimeScope!),
    );
    const { actor, resource } = getKnowledgeBaseAuthorizationTarget(ctx);
    await recordAuditEvent({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'knowledge_base.update',
      resource: {
        ...resource,
        resourceType: 'instruction',
        resourceId: id,
      },
      result: 'succeeded',
      payloadJson: {
        operation: 'delete_instruction',
      },
    });
    return true;
  }

  private async assertExecutableRuntimeScope(ctx: IContext) {
    try {
      await assertLatestExecutableRuntimeScope({
        runtimeScope: ctx.runtimeScope!,
        knowledgeBaseRepository: ctx.knowledgeBaseRepository,
        kbSnapshotRepository: ctx.kbSnapshotRepository,
      });
    } catch (error) {
      throw Errors.create(Errors.GeneralErrorCodes.OUTDATED_RUNTIME_SNAPSHOT, {
        customMessage:
          error instanceof Error ? error.message : 'Snapshot outdated',
      });
    }
  }
}
