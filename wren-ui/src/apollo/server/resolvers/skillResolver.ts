import { IContext } from '@server/types';
import { SkillBinding, SkillDefinition } from '@server/repositories';
import { getLogger } from '@server/utils';

const logger = getLogger('SkillResolver');
logger.level = 'debug';

const requireWorkspaceId = (ctx: IContext) => {
  const workspaceId = ctx.runtimeScope?.workspace?.id;
  if (!workspaceId) {
    throw new Error('Active runtime workspace is required for this operation');
  }
  return workspaceId;
};

const requireKnowledgeBaseId = (ctx: IContext) => {
  const knowledgeBaseId = ctx.runtimeScope?.knowledgeBase?.id;
  if (!knowledgeBaseId) {
    throw new Error(
      'Active runtime knowledge base is required for this operation',
    );
  }
  return knowledgeBaseId;
};

const toSkillDefinitionView = (skillDefinition: SkillDefinition) => ({
  ...skillDefinition,
  manifest: skillDefinition.manifestJson ?? null,
});

const toSkillBindingView = (skillBinding: SkillBinding) => ({
  ...skillBinding,
  bindingConfig: skillBinding.bindingConfig ?? null,
});

export class SkillResolver {
  constructor() {
    this.getSkillDefinitions = this.getSkillDefinitions.bind(this);
    this.getSkillBindings = this.getSkillBindings.bind(this);
    this.createSkillDefinition = this.createSkillDefinition.bind(this);
    this.updateSkillDefinition = this.updateSkillDefinition.bind(this);
    this.deleteSkillDefinition = this.deleteSkillDefinition.bind(this);
    this.createSkillBinding = this.createSkillBinding.bind(this);
    this.updateSkillBinding = this.updateSkillBinding.bind(this);
    this.deleteSkillBinding = this.deleteSkillBinding.bind(this);
  }

  public async getSkillDefinitions(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<Array<ReturnType<typeof toSkillDefinitionView>>> {
    try {
      const workspaceId = requireWorkspaceId(ctx);
      const definitions =
        await ctx.skillService.listSkillDefinitionsByWorkspace(workspaceId);
      return definitions.map(toSkillDefinitionView);
    } catch (error) {
      logger.error(`Error getting skill definitions: ${error}`);
      throw error;
    }
  }

  public async getSkillBindings(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<Array<ReturnType<typeof toSkillBindingView>>> {
    try {
      const knowledgeBaseId = requireKnowledgeBaseId(ctx);
      const bindings =
        await ctx.skillService.listSkillBindingsByKnowledgeBase(knowledgeBaseId);
      return bindings.map(toSkillBindingView);
    } catch (error) {
      logger.error(`Error getting skill bindings: ${error}`);
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
      };
    },
    ctx: IContext,
  ): Promise<ReturnType<typeof toSkillDefinitionView>> {
    const workspaceId = requireWorkspaceId(ctx);
    const skillDefinition = await ctx.skillService.createSkillDefinition({
      workspaceId,
      name: args.data.name,
      runtimeKind: args.data.runtimeKind,
      sourceType: args.data.sourceType,
      sourceRef: args.data.sourceRef,
      entrypoint: args.data.entrypoint,
      manifest: args.data.manifest,
      createdBy: ctx.runtimeScope?.userId || undefined,
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
      };
    },
    ctx: IContext,
  ): Promise<ReturnType<typeof toSkillDefinitionView>> {
    const workspaceId = requireWorkspaceId(ctx);
    const existing = await ctx.skillService.getSkillDefinitionById(args.where.id);
    if (!existing || existing.workspaceId !== workspaceId) {
      throw new Error('Skill definition not found in active runtime workspace');
    }

    const skillDefinition = await ctx.skillService.updateSkillDefinition(
      args.where.id,
      args.data,
    );
    return toSkillDefinitionView(skillDefinition);
  }

  public async deleteSkillDefinition(
    _root: any,
    args: { where: { id: string } },
    ctx: IContext,
  ): Promise<boolean> {
    const workspaceId = requireWorkspaceId(ctx);
    const existing = await ctx.skillService.getSkillDefinitionById(args.where.id);
    if (!existing || existing.workspaceId !== workspaceId) {
      throw new Error('Skill definition not found in active runtime workspace');
    }

    await ctx.skillService.deleteSkillDefinition(args.where.id);
    return true;
  }

  public async createSkillBinding(
    _root: any,
    args: {
      data: {
        kbSnapshotId?: string | null;
        skillDefinitionId: string;
        connectorId?: string | null;
        bindingConfig?: Record<string, any> | null;
        enabled?: boolean;
      };
    },
    ctx: IContext,
  ): Promise<ReturnType<typeof toSkillBindingView>> {
    const knowledgeBaseId = requireKnowledgeBaseId(ctx);
    const skillBinding = await ctx.skillService.createSkillBinding({
      knowledgeBaseId,
      kbSnapshotId:
        args.data.kbSnapshotId ?? ctx.runtimeScope?.kbSnapshot?.id ?? null,
      skillDefinitionId: args.data.skillDefinitionId,
      connectorId: args.data.connectorId,
      bindingConfig: args.data.bindingConfig,
      enabled: args.data.enabled,
      createdBy: ctx.runtimeScope?.userId || undefined,
    });

    return toSkillBindingView(skillBinding);
  }

  public async updateSkillBinding(
    _root: any,
    args: {
      where: { id: string };
      data: {
        kbSnapshotId?: string | null;
        connectorId?: string | null;
        bindingConfig?: Record<string, any> | null;
        enabled?: boolean;
      };
    },
    ctx: IContext,
  ): Promise<ReturnType<typeof toSkillBindingView>> {
    const knowledgeBaseId = requireKnowledgeBaseId(ctx);
    const existing = await ctx.skillService.getSkillBindingById(args.where.id);
    if (!existing || existing.knowledgeBaseId !== knowledgeBaseId) {
      throw new Error('Skill binding not found in active runtime knowledge base');
    }

    const skillBinding = await ctx.skillService.updateSkillBinding(
      args.where.id,
      args.data,
    );
    return toSkillBindingView(skillBinding);
  }

  public async deleteSkillBinding(
    _root: any,
    args: { where: { id: string } },
    ctx: IContext,
  ): Promise<boolean> {
    const knowledgeBaseId = requireKnowledgeBaseId(ctx);
    const existing = await ctx.skillService.getSkillBindingById(args.where.id);
    if (!existing || existing.knowledgeBaseId !== knowledgeBaseId) {
      throw new Error('Skill binding not found in active runtime knowledge base');
    }

    await ctx.skillService.deleteSkillBinding(args.where.id);
    return true;
  }
}
