import { IContext } from '@server/types';
import { SkillDefinition, SkillMarketplaceCatalog } from '@server/repositories';
import { getLogger } from '@server/utils';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  recordAuditEvent,
} from '@server/authz';

const logger = getLogger('SkillController');
logger.level = 'debug';

const requireWorkspaceId = (ctx: IContext) => {
  const workspaceId = ctx.runtimeScope?.workspace?.id;
  if (!workspaceId) {
    throw new Error('Active runtime workspace is required for this operation');
  }
  return workspaceId;
};

const requireAuthorizationActor = (ctx: IContext) =>
  ctx.authorizationActor ||
  buildAuthorizationActorFromRuntimeScope(ctx.runtimeScope);

const toSkillDefinitionView = (skillDefinition: SkillDefinition) => ({
  ...skillDefinition,
  manifest: skillDefinition.manifestJson ?? null,
  runtimeConfig: skillDefinition.runtimeConfigJson ?? null,
  kbSuggestionIds: skillDefinition.kbSuggestionIds ?? null,
  isEnabled: skillDefinition.isEnabled ?? true,
  executionMode: 'inject_only' as const,
  installedFrom: skillDefinition.installedFrom ?? 'custom',
  hasSecret: Boolean(skillDefinition.secretRecordId),
});

const toSkillMarketplaceCatalogView = (catalog: SkillMarketplaceCatalog) => ({
  ...catalog,
  manifest: catalog.manifestJson ?? null,
  defaultExecutionMode: 'inject_only' as const,
  isBuiltin: catalog.isBuiltin ?? false,
  isFeatured: catalog.isFeatured ?? false,
  installCount: catalog.installCount ?? 0,
});

export class SkillController {
  constructor() {
    this.getSkillDefinitions = this.getSkillDefinitions.bind(this);
    this.getAvailableSkills = this.getAvailableSkills.bind(this);
    this.getMarketplaceCatalogSkills =
      this.getMarketplaceCatalogSkills.bind(this);
    this.createSkillDefinition = this.createSkillDefinition.bind(this);
    this.updateSkillDefinition = this.updateSkillDefinition.bind(this);
    this.installSkillFromMarketplace =
      this.installSkillFromMarketplace.bind(this);
    this.toggleSkillEnabled = this.toggleSkillEnabled.bind(this);
    this.updateSkillDefinitionRuntime =
      this.updateSkillDefinitionRuntime.bind(this);
    this.deleteSkillDefinition = this.deleteSkillDefinition.bind(this);
  }

  public async getSkillDefinitions(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<Array<ReturnType<typeof toSkillDefinitionView>>> {
    try {
      const workspaceId = requireWorkspaceId(ctx);
      await assertAuthorizedWithAudit({
        auditEventRepository: ctx.auditEventRepository,
        actor: requireAuthorizationActor(ctx),
        action: 'skill.read',
        resource: {
          resourceType: 'workspace',
          resourceId: workspaceId,
          workspaceId,
        },
      });
      const definitions =
        await ctx.skillService.listSkillDefinitionsByWorkspace(workspaceId);
      const result = definitions.map(toSkillDefinitionView);
      await recordAuditEvent({
        auditEventRepository: ctx.auditEventRepository,
        actor: requireAuthorizationActor(ctx),
        action: 'skill.read',
        resource: {
          resourceType: 'workspace',
          resourceId: workspaceId,
          workspaceId,
        },
        result: 'allowed',
        payloadJson: {
          operation: 'get_skill_definitions',
        },
      });
      return result;
    } catch (error) {
      logger.error(`Error getting skill definitions: ${error}`);
      throw error;
    }
  }

  public async getAvailableSkills(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<Array<ReturnType<typeof toSkillDefinitionView>>> {
    try {
      const workspaceId = requireWorkspaceId(ctx);
      await assertAuthorizedWithAudit({
        auditEventRepository: ctx.auditEventRepository,
        actor: requireAuthorizationActor(ctx),
        action: 'skill.read',
        resource: {
          resourceType: 'workspace',
          resourceId: workspaceId,
          workspaceId,
        },
      });
      const definitions =
        await ctx.skillService.listAvailableSkills(workspaceId);
      const result = definitions.map(toSkillDefinitionView);
      await recordAuditEvent({
        auditEventRepository: ctx.auditEventRepository,
        actor: requireAuthorizationActor(ctx),
        action: 'skill.read',
        resource: {
          resourceType: 'workspace',
          resourceId: workspaceId,
          workspaceId,
        },
        result: 'allowed',
        payloadJson: {
          operation: 'get_available_skills',
        },
      });
      return result;
    } catch (error) {
      logger.error(`Error getting available skills: ${error}`);
      throw error;
    }
  }

  public async getMarketplaceCatalogSkills(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<Array<ReturnType<typeof toSkillMarketplaceCatalogView>>> {
    try {
      const workspaceId = requireWorkspaceId(ctx);
      await assertAuthorizedWithAudit({
        auditEventRepository: ctx.auditEventRepository,
        actor: requireAuthorizationActor(ctx),
        action: 'skill.read',
        resource: {
          resourceType: 'workspace',
          resourceId: workspaceId,
          workspaceId,
        },
      });
      const catalogSkills =
        await ctx.skillService.listMarketplaceCatalogSkills();
      const result = catalogSkills.map(toSkillMarketplaceCatalogView);
      await recordAuditEvent({
        auditEventRepository: ctx.auditEventRepository,
        actor: requireAuthorizationActor(ctx),
        action: 'skill.read',
        resource: {
          resourceType: 'workspace',
          resourceId: workspaceId,
          workspaceId,
        },
        result: 'allowed',
        payloadJson: {
          operation: 'get_marketplace_catalog_skills',
        },
      });
      return result;
    } catch (error) {
      logger.error(`Error getting marketplace catalog skills: ${error}`);
      throw error;
    }
  }

  public async createSkillDefinition(
    _root: any,
    args: {
      data: {
        name: string;
        runtimeKind?: string;
        sourceType?: string;
        sourceRef?: string | null;
        entrypoint?: string | null;
        manifest?: Record<string, any> | null;
        secret?: Record<string, any> | null;
      };
    },
    ctx: IContext,
  ): Promise<ReturnType<typeof toSkillDefinitionView>> {
    const workspaceId = requireWorkspaceId(ctx);
    const actor = requireAuthorizationActor(ctx);
    await assertAuthorizedWithAudit({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'skill.create',
      resource: {
        resourceType: 'workspace',
        resourceId: workspaceId,
        workspaceId,
      },
    });
    const skillDefinition = await ctx.skillService.createSkillDefinition({
      workspaceId,
      name: args.data.name,
      runtimeKind: args.data.runtimeKind,
      sourceType: args.data.sourceType,
      sourceRef: args.data.sourceRef,
      entrypoint: args.data.entrypoint,
      manifest: args.data.manifest,
      secret: args.data.secret,
      createdBy: ctx.runtimeScope?.userId || undefined,
    });
    await recordAuditEvent({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'skill.create',
      resource: {
        resourceType: 'skill_definition',
        resourceId: skillDefinition.id,
        workspaceId,
      },
      result: 'succeeded',
      afterJson: skillDefinition as any,
    });

    return toSkillDefinitionView(skillDefinition);
  }

  public async updateSkillDefinition(
    _root: any,
    args: {
      where: { id: string };
      data: {
        name?: string;
        runtimeKind?: string;
        sourceType?: string;
        sourceRef?: string | null;
        entrypoint?: string | null;
        manifest?: Record<string, any> | null;
        secret?: Record<string, any> | null;
      };
    },
    ctx: IContext,
  ): Promise<ReturnType<typeof toSkillDefinitionView>> {
    const workspaceId = requireWorkspaceId(ctx);
    const actor = requireAuthorizationActor(ctx);
    const existing = await ctx.skillService.getSkillDefinitionById(
      args.where.id,
    );
    if (!existing || existing.workspaceId !== workspaceId) {
      throw new Error('Skill definition not found in active runtime workspace');
    }
    await assertAuthorizedWithAudit({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'skill.update',
      resource: {
        resourceType: 'skill_definition',
        resourceId: existing.id,
        workspaceId,
      },
    });

    const skillDefinition = await ctx.skillService.updateSkillDefinition(
      args.where.id,
      args.data,
    );
    await recordAuditEvent({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'skill.update',
      resource: {
        resourceType: 'skill_definition',
        resourceId: existing.id,
        workspaceId,
      },
      result: 'succeeded',
      beforeJson: existing as any,
      afterJson: skillDefinition as any,
    });
    return toSkillDefinitionView(skillDefinition);
  }

  public async deleteSkillDefinition(
    _root: any,
    args: { where: { id: string } },
    ctx: IContext,
  ): Promise<boolean> {
    const workspaceId = requireWorkspaceId(ctx);
    const actor = requireAuthorizationActor(ctx);
    const existing = await ctx.skillService.getSkillDefinitionById(
      args.where.id,
    );
    if (!existing || existing.workspaceId !== workspaceId) {
      throw new Error('Skill definition not found in active runtime workspace');
    }
    await assertAuthorizedWithAudit({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'skill.delete',
      resource: {
        resourceType: 'skill_definition',
        resourceId: existing.id,
        workspaceId,
      },
    });

    await ctx.skillService.deleteSkillDefinition(args.where.id);
    await recordAuditEvent({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'skill.delete',
      resource: {
        resourceType: 'skill_definition',
        resourceId: existing.id,
        workspaceId,
      },
      result: 'succeeded',
      beforeJson: existing as any,
    });
    return true;
  }

  public async installSkillFromMarketplace(
    _root: any,
    args: { catalogId: string },
    ctx: IContext,
  ): Promise<ReturnType<typeof toSkillDefinitionView>> {
    const workspaceId = requireWorkspaceId(ctx);
    const actor = requireAuthorizationActor(ctx);
    await assertAuthorizedWithAudit({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'skill.create',
      resource: {
        resourceType: 'workspace',
        resourceId: workspaceId,
        workspaceId,
      },
    });
    const skillDefinition = await ctx.skillService.installSkillFromMarketplace({
      workspaceId,
      catalogId: args.catalogId,
      userId: ctx.runtimeScope?.userId || undefined,
    });
    await recordAuditEvent({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'skill.create',
      resource: {
        resourceType: 'skill_definition',
        resourceId: skillDefinition.id,
        workspaceId,
      },
      result: 'succeeded',
      afterJson: skillDefinition as any,
      payloadJson: {
        catalogId: args.catalogId,
        installedFrom: 'marketplace',
      },
    });

    return toSkillDefinitionView(skillDefinition);
  }

  public async toggleSkillEnabled(
    _root: any,
    args: { skillDefinitionId: string; enabled: boolean },
    ctx: IContext,
  ): Promise<ReturnType<typeof toSkillDefinitionView>> {
    const workspaceId = requireWorkspaceId(ctx);
    const actor = requireAuthorizationActor(ctx);
    await assertAuthorizedWithAudit({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'skill.update',
      resource: {
        resourceType: 'skill_definition',
        resourceId: args.skillDefinitionId,
        workspaceId,
      },
    });
    const skillDefinition = await ctx.skillService.toggleSkillEnabled(
      workspaceId,
      args.skillDefinitionId,
      args.enabled,
    );
    await recordAuditEvent({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'skill.update',
      resource: {
        resourceType: 'skill_definition',
        resourceId: skillDefinition.id,
        workspaceId,
      },
      result: 'succeeded',
      afterJson: skillDefinition as any,
      payloadJson: {
        isEnabled: args.enabled,
      },
    });

    return toSkillDefinitionView(skillDefinition);
  }

  public async updateSkillDefinitionRuntime(
    _root: any,
    args: {
      where: { id: string };
      data: {
        instruction?: string | null;
        isEnabled?: boolean;
        executionMode?: 'inject_only';
        connectorId?: string | null;
        runtimeConfig?: Record<string, any> | null;
        kbSuggestionIds?: string[] | null;
      };
    },
    ctx: IContext,
  ): Promise<ReturnType<typeof toSkillDefinitionView>> {
    const workspaceId = requireWorkspaceId(ctx);
    const actor = requireAuthorizationActor(ctx);
    const existing = await ctx.skillService.getSkillDefinitionById(
      args.where.id,
    );
    if (!existing || existing.workspaceId !== workspaceId) {
      throw new Error('Skill definition not found in active runtime workspace');
    }
    await assertAuthorizedWithAudit({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'skill.update',
      resource: {
        resourceType: 'skill_definition',
        resourceId: existing.id,
        workspaceId,
      },
    });

    const skillDefinition = await ctx.skillService.updateSkillDefinitionRuntime(
      args.where.id,
      args.data,
    );
    await recordAuditEvent({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'skill.update',
      resource: {
        resourceType: 'skill_definition',
        resourceId: existing.id,
        workspaceId,
      },
      result: 'succeeded',
      beforeJson: existing as any,
      afterJson: skillDefinition as any,
    });
    return toSkillDefinitionView(skillDefinition);
  }
}
