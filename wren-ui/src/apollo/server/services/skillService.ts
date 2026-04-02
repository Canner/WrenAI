import crypto from 'crypto';
import {
  IConnectorRepository,
  IKBSnapshotRepository,
  IKnowledgeBaseRepository,
  IQueryOptions,
  ISkillBindingRepository,
  ISkillDefinitionRepository,
  IWorkspaceRepository,
  SkillBinding,
  SkillDefinition,
} from '../repositories';

export interface CreateSkillDefinitionInput {
  workspaceId: string;
  name: string;
  runtimeKind?: string;
  sourceType?: string;
  sourceRef?: string | null;
  entrypoint?: string | null;
  manifest?: Record<string, any> | null;
  createdBy?: string | null;
}

export interface UpdateSkillDefinitionInput {
  name?: string;
  runtimeKind?: string;
  sourceType?: string;
  sourceRef?: string | null;
  entrypoint?: string | null;
  manifest?: Record<string, any> | null;
}

export interface CreateSkillBindingInput {
  knowledgeBaseId: string;
  kbSnapshotId?: string | null;
  skillDefinitionId: string;
  connectorId?: string | null;
  bindingConfig?: Record<string, any> | null;
  enabled?: boolean;
  createdBy?: string | null;
}

export interface UpdateSkillBindingInput {
  kbSnapshotId?: string | null;
  connectorId?: string | null;
  bindingConfig?: Record<string, any> | null;
  enabled?: boolean;
}

export interface ISkillService {
  createSkillDefinition(input: CreateSkillDefinitionInput): Promise<SkillDefinition>;
  updateSkillDefinition(
    skillDefinitionId: string,
    input: UpdateSkillDefinitionInput,
  ): Promise<SkillDefinition>;
  getSkillDefinitionById(skillDefinitionId: string): Promise<SkillDefinition | null>;
  listSkillDefinitionsByWorkspace(workspaceId: string): Promise<SkillDefinition[]>;
  deleteSkillDefinition(skillDefinitionId: string): Promise<void>;
  createSkillBinding(input: CreateSkillBindingInput): Promise<SkillBinding>;
  updateSkillBinding(
    skillBindingId: string,
    input: UpdateSkillBindingInput,
  ): Promise<SkillBinding>;
  getSkillBindingById(skillBindingId: string): Promise<SkillBinding | null>;
  listSkillBindingsByKnowledgeBase(knowledgeBaseId: string): Promise<SkillBinding[]>;
  deleteSkillBinding(skillBindingId: string): Promise<void>;
}

export class SkillService implements ISkillService {
  private workspaceRepository: IWorkspaceRepository;
  private knowledgeBaseRepository: IKnowledgeBaseRepository;
  private kbSnapshotRepository: IKBSnapshotRepository;
  private connectorRepository: IConnectorRepository;
  private skillDefinitionRepository: ISkillDefinitionRepository;
  private skillBindingRepository: ISkillBindingRepository;

  constructor({
    workspaceRepository,
    knowledgeBaseRepository,
    kbSnapshotRepository,
    connectorRepository,
    skillDefinitionRepository,
    skillBindingRepository,
  }: {
    workspaceRepository: IWorkspaceRepository;
    knowledgeBaseRepository: IKnowledgeBaseRepository;
    kbSnapshotRepository: IKBSnapshotRepository;
    connectorRepository: IConnectorRepository;
    skillDefinitionRepository: ISkillDefinitionRepository;
    skillBindingRepository: ISkillBindingRepository;
  }) {
    this.workspaceRepository = workspaceRepository;
    this.knowledgeBaseRepository = knowledgeBaseRepository;
    this.kbSnapshotRepository = kbSnapshotRepository;
    this.connectorRepository = connectorRepository;
    this.skillDefinitionRepository = skillDefinitionRepository;
    this.skillBindingRepository = skillBindingRepository;
  }

  public async createSkillDefinition(
    input: CreateSkillDefinitionInput,
  ): Promise<SkillDefinition> {
    const tx = await this.skillDefinitionRepository.transaction();

    try {
      await this.ensureWorkspaceExists(input.workspaceId, { tx });
      await this.ensureSkillNameAvailable(input.workspaceId, input.name, {
        tx,
      });

      const skillDefinition = await this.skillDefinitionRepository.createOne(
        {
          id: crypto.randomUUID(),
          workspaceId: input.workspaceId,
          name: input.name,
          runtimeKind: input.runtimeKind || 'isolated_python',
          sourceType: input.sourceType || 'inline',
          sourceRef: input.sourceRef ?? null,
          entrypoint: input.entrypoint ?? null,
          manifestJson: input.manifest ?? null,
          createdBy: input.createdBy,
        },
        { tx },
      );

      await this.skillDefinitionRepository.commit(tx);
      return skillDefinition;
    } catch (error) {
      await this.skillDefinitionRepository.rollback(tx);
      throw error;
    }
  }

  public async updateSkillDefinition(
    skillDefinitionId: string,
    input: UpdateSkillDefinitionInput,
  ): Promise<SkillDefinition> {
    const tx = await this.skillDefinitionRepository.transaction();

    try {
      const skillDefinition = await this.skillDefinitionRepository.findOneBy(
        { id: skillDefinitionId },
        { tx },
      );
      if (!skillDefinition) {
        throw new Error(`Skill definition ${skillDefinitionId} not found`);
      }

      if (
        input.name !== undefined &&
        input.name !== skillDefinition.name
      ) {
        await this.ensureSkillNameAvailable(
          skillDefinition.workspaceId,
          input.name,
          { tx },
          skillDefinition.id,
        );
      }

      const patch: Partial<SkillDefinition> = {};
      if (input.name !== undefined) {
        patch.name = input.name;
      }
      if (input.runtimeKind !== undefined) {
        patch.runtimeKind = input.runtimeKind;
      }
      if (input.sourceType !== undefined) {
        patch.sourceType = input.sourceType;
      }
      if (Object.prototype.hasOwnProperty.call(input, 'sourceRef')) {
        patch.sourceRef = input.sourceRef ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(input, 'entrypoint')) {
        patch.entrypoint = input.entrypoint ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(input, 'manifest')) {
        patch.manifestJson = input.manifest ?? null;
      }

      const updatedSkillDefinition =
        Object.keys(patch).length === 0
          ? skillDefinition
          : await this.skillDefinitionRepository.updateOne(
              skillDefinitionId,
              patch,
              { tx },
            );

      await this.skillDefinitionRepository.commit(tx);
      return updatedSkillDefinition;
    } catch (error) {
      await this.skillDefinitionRepository.rollback(tx);
      throw error;
    }
  }

  public async getSkillDefinitionById(
    skillDefinitionId: string,
  ): Promise<SkillDefinition | null> {
    return await this.skillDefinitionRepository.findOneBy({ id: skillDefinitionId });
  }

  public async listSkillDefinitionsByWorkspace(
    workspaceId: string,
  ): Promise<SkillDefinition[]> {
    return await this.skillDefinitionRepository.findAllBy({ workspaceId });
  }

  public async deleteSkillDefinition(skillDefinitionId: string): Promise<void> {
    const tx = await this.skillDefinitionRepository.transaction();

    try {
      const skillDefinition = await this.skillDefinitionRepository.findOneBy(
        { id: skillDefinitionId },
        { tx },
      );
      if (!skillDefinition) {
        throw new Error(`Skill definition ${skillDefinitionId} not found`);
      }

      await this.skillDefinitionRepository.deleteOne(skillDefinitionId, { tx });
      await this.skillDefinitionRepository.commit(tx);
    } catch (error) {
      await this.skillDefinitionRepository.rollback(tx);
      throw error;
    }
  }

  public async createSkillBinding(
    input: CreateSkillBindingInput,
  ): Promise<SkillBinding> {
    const tx = await this.skillBindingRepository.transaction();

    try {
      const knowledgeBase = await this.requireKnowledgeBase(
        input.knowledgeBaseId,
        { tx },
      );
      const skillDefinition = await this.requireSkillDefinition(
        input.skillDefinitionId,
        { tx },
      );
      if (skillDefinition.workspaceId !== knowledgeBase.workspaceId) {
        throw new Error(
          `Skill definition ${input.skillDefinitionId} does not belong to workspace ${knowledgeBase.workspaceId}`,
        );
      }

      await this.ensureSnapshotMatchesKnowledgeBase(
        input.knowledgeBaseId,
        input.kbSnapshotId,
        { tx },
      );
      await this.ensureConnectorMatchesKnowledgeBase(
        knowledgeBase.workspaceId,
        input.knowledgeBaseId,
        input.connectorId,
        { tx },
      );

      const skillBinding = await this.skillBindingRepository.createOne(
        {
          id: crypto.randomUUID(),
          knowledgeBaseId: input.knowledgeBaseId,
          kbSnapshotId: input.kbSnapshotId ?? null,
          skillDefinitionId: input.skillDefinitionId,
          connectorId: input.connectorId ?? null,
          bindingConfig: input.bindingConfig ?? null,
          enabled: input.enabled ?? true,
          createdBy: input.createdBy,
        },
        { tx },
      );

      await this.skillBindingRepository.commit(tx);
      return skillBinding;
    } catch (error) {
      await this.skillBindingRepository.rollback(tx);
      throw error;
    }
  }

  public async updateSkillBinding(
    skillBindingId: string,
    input: UpdateSkillBindingInput,
  ): Promise<SkillBinding> {
    const tx = await this.skillBindingRepository.transaction();

    try {
      const skillBinding = await this.skillBindingRepository.findOneBy(
        { id: skillBindingId },
        { tx },
      );
      if (!skillBinding) {
        throw new Error(`Skill binding ${skillBindingId} not found`);
      }

      const knowledgeBase = await this.requireKnowledgeBase(
        skillBinding.knowledgeBaseId,
        { tx },
      );

      if (Object.prototype.hasOwnProperty.call(input, 'kbSnapshotId')) {
        await this.ensureSnapshotMatchesKnowledgeBase(
          skillBinding.knowledgeBaseId,
          input.kbSnapshotId,
          { tx },
        );
      }
      if (Object.prototype.hasOwnProperty.call(input, 'connectorId')) {
        await this.ensureConnectorMatchesKnowledgeBase(
          knowledgeBase.workspaceId,
          skillBinding.knowledgeBaseId,
          input.connectorId,
          { tx },
        );
      }

      const patch: Partial<SkillBinding> = {};
      if (Object.prototype.hasOwnProperty.call(input, 'kbSnapshotId')) {
        patch.kbSnapshotId = input.kbSnapshotId ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(input, 'connectorId')) {
        patch.connectorId = input.connectorId ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(input, 'bindingConfig')) {
        patch.bindingConfig = input.bindingConfig ?? null;
      }
      if (input.enabled !== undefined) {
        patch.enabled = input.enabled;
      }

      const updatedSkillBinding =
        Object.keys(patch).length === 0
          ? skillBinding
          : await this.skillBindingRepository.updateOne(skillBindingId, patch, {
              tx,
            });

      await this.skillBindingRepository.commit(tx);
      return updatedSkillBinding;
    } catch (error) {
      await this.skillBindingRepository.rollback(tx);
      throw error;
    }
  }

  public async getSkillBindingById(
    skillBindingId: string,
  ): Promise<SkillBinding | null> {
    return await this.skillBindingRepository.findOneBy({ id: skillBindingId });
  }

  public async listSkillBindingsByKnowledgeBase(
    knowledgeBaseId: string,
  ): Promise<SkillBinding[]> {
    return await this.skillBindingRepository.findAllBy({ knowledgeBaseId });
  }

  public async deleteSkillBinding(skillBindingId: string): Promise<void> {
    const tx = await this.skillBindingRepository.transaction();

    try {
      const skillBinding = await this.skillBindingRepository.findOneBy(
        { id: skillBindingId },
        { tx },
      );
      if (!skillBinding) {
        throw new Error(`Skill binding ${skillBindingId} not found`);
      }

      await this.skillBindingRepository.deleteOne(skillBindingId, { tx });
      await this.skillBindingRepository.commit(tx);
    } catch (error) {
      await this.skillBindingRepository.rollback(tx);
      throw error;
    }
  }

  private async ensureWorkspaceExists(
    workspaceId: string,
    queryOptions?: IQueryOptions,
  ) {
    const workspace = await this.workspaceRepository.findOneBy(
      { id: workspaceId },
      queryOptions,
    );
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }
  }

  private async ensureSkillNameAvailable(
    workspaceId: string,
    name: string,
    queryOptions?: IQueryOptions,
    currentSkillDefinitionId?: string,
  ) {
    const existingSkillDefinition = await this.skillDefinitionRepository.findOneBy(
      { workspaceId, name },
      queryOptions,
    );
    if (
      existingSkillDefinition &&
      existingSkillDefinition.id !== currentSkillDefinitionId
    ) {
      throw new Error(
        `Skill definition ${name} already exists in workspace ${workspaceId}`,
      );
    }
  }

  private async requireKnowledgeBase(
    knowledgeBaseId: string,
    queryOptions?: IQueryOptions,
  ) {
    const knowledgeBase = await this.knowledgeBaseRepository.findOneBy(
      { id: knowledgeBaseId },
      queryOptions,
    );
    if (!knowledgeBase) {
      throw new Error(`Knowledge base ${knowledgeBaseId} not found`);
    }
    return knowledgeBase;
  }

  private async requireSkillDefinition(
    skillDefinitionId: string,
    queryOptions?: IQueryOptions,
  ) {
    const skillDefinition = await this.skillDefinitionRepository.findOneBy(
      { id: skillDefinitionId },
      queryOptions,
    );
    if (!skillDefinition) {
      throw new Error(`Skill definition ${skillDefinitionId} not found`);
    }
    return skillDefinition;
  }

  private async ensureSnapshotMatchesKnowledgeBase(
    knowledgeBaseId: string,
    kbSnapshotId?: string | null,
    queryOptions?: IQueryOptions,
  ) {
    if (!kbSnapshotId) {
      return;
    }

    const kbSnapshot = await this.kbSnapshotRepository.findOneBy(
      { id: kbSnapshotId },
      queryOptions,
    );
    if (!kbSnapshot || kbSnapshot.knowledgeBaseId !== knowledgeBaseId) {
      throw new Error(
        `KB snapshot ${kbSnapshotId} does not belong to knowledge base ${knowledgeBaseId}`,
      );
    }
  }

  private async ensureConnectorMatchesKnowledgeBase(
    workspaceId: string,
    knowledgeBaseId: string,
    connectorId?: string | null,
    queryOptions?: IQueryOptions,
  ) {
    if (!connectorId) {
      return;
    }

    const connector = await this.connectorRepository.findOneBy(
      { id: connectorId },
      queryOptions,
    );
    if (!connector || connector.workspaceId !== workspaceId) {
      throw new Error(
        `Connector ${connectorId} does not belong to workspace ${workspaceId}`,
      );
    }
    if (connector.knowledgeBaseId && connector.knowledgeBaseId !== knowledgeBaseId) {
      throw new Error(
        `Connector ${connectorId} does not belong to knowledge base ${knowledgeBaseId}`,
      );
    }
  }
}
