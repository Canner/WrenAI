import crypto from 'crypto';
import {
  IConnectorRepository,
  IQueryOptions,
  ISkillDefinitionRepository,
  ISkillMarketplaceCatalogRepository,
  IWorkspaceRepository,
  SkillDefinition,
  SkillExecutionMode,
  SkillInstalledFrom,
  SkillMarketplaceCatalog,
} from '../repositories';
import { ISecretService, SecretPayload } from './secretService';

export interface CreateSkillDefinitionInput {
  workspaceId: string;
  name: string;
  runtimeKind?: string;
  sourceType?: string;
  sourceRef?: string | null;
  entrypoint?: string | null;
  manifest?: Record<string, any> | null;
  catalogId?: string | null;
  instruction?: string | null;
  isEnabled?: boolean;
  executionMode?: SkillExecutionMode;
  connectorId?: string | null;
  runtimeConfig?: Record<string, any> | null;
  kbSuggestionIds?: string[] | null;
  installedFrom?: SkillInstalledFrom;
  migrationSourceBindingId?: string | null;
  secret?: SecretPayload | null;
  createdBy?: string | null;
}

export interface UpdateSkillDefinitionInput {
  name?: string;
  runtimeKind?: string;
  sourceType?: string;
  sourceRef?: string | null;
  entrypoint?: string | null;
  manifest?: Record<string, any> | null;
  secret?: SecretPayload | null;
}

export interface UpdateSkillDefinitionRuntimeInput {
  instruction?: string | null;
  isEnabled?: boolean;
  executionMode?: SkillExecutionMode;
  connectorId?: string | null;
  runtimeConfig?: Record<string, any> | null;
  kbSuggestionIds?: string[] | null;
}

export interface ISkillService {
  createSkillDefinition(
    input: CreateSkillDefinitionInput,
  ): Promise<SkillDefinition>;
  updateSkillDefinition(
    skillDefinitionId: string,
    input: UpdateSkillDefinitionInput,
  ): Promise<SkillDefinition>;
  getSkillDefinitionById(
    skillDefinitionId: string,
  ): Promise<SkillDefinition | null>;
  resolveSkillSecret(skillDefinitionId: string): Promise<SecretPayload | null>;
  getResolvedSkillDefinition(
    skillDefinitionId: string,
  ): Promise<ResolvedSkillDefinition | null>;
  listSkillDefinitionsByWorkspace(
    workspaceId: string,
  ): Promise<SkillDefinition[]>;
  listAvailableSkills(workspaceId: string): Promise<SkillDefinition[]>;
  listMarketplaceCatalogSkills(): Promise<SkillMarketplaceCatalog[]>;
  installSkillFromMarketplace(input: {
    workspaceId: string;
    catalogId: string;
    userId?: string | null;
  }): Promise<SkillDefinition>;
  toggleSkillEnabled(
    workspaceId: string,
    skillDefinitionId: string,
    enabled: boolean,
  ): Promise<SkillDefinition>;
  updateSkillDefinitionRuntime(
    skillDefinitionId: string,
    input: UpdateSkillDefinitionRuntimeInput,
  ): Promise<SkillDefinition>;
  deleteSkillDefinition(skillDefinitionId: string): Promise<void>;
}

export interface ResolvedSkillDefinition extends SkillDefinition {
  secret: SecretPayload | null;
}

const normalizeSkillExecutionMode = (): SkillExecutionMode => 'inject_only';

export class SkillService implements ISkillService {
  private workspaceRepository: IWorkspaceRepository;
  private connectorRepository: IConnectorRepository;
  private secretService: ISecretService;
  private skillDefinitionRepository: ISkillDefinitionRepository;
  private skillMarketplaceCatalogRepository: ISkillMarketplaceCatalogRepository;

  constructor({
    workspaceRepository,
    connectorRepository,
    secretService,
    skillDefinitionRepository,
    skillMarketplaceCatalogRepository,
  }: {
    workspaceRepository: IWorkspaceRepository;
    connectorRepository: IConnectorRepository;
    secretService: ISecretService;
    skillDefinitionRepository: ISkillDefinitionRepository;
    skillMarketplaceCatalogRepository: ISkillMarketplaceCatalogRepository;
  }) {
    this.workspaceRepository = workspaceRepository;
    this.connectorRepository = connectorRepository;
    this.secretService = secretService;
    this.skillDefinitionRepository = skillDefinitionRepository;
    this.skillMarketplaceCatalogRepository = skillMarketplaceCatalogRepository;
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
      await this.ensureConnectorMatchesWorkspace(
        input.workspaceId,
        input.connectorId,
        { tx },
      );
      const skillDefinitionId = crypto.randomUUID();
      let secretRecordId: string | null = null;

      if (input.secret) {
        const secretRecord = await this.secretService.createSecretRecord(
          {
            workspaceId: input.workspaceId,
            scopeType: 'skill',
            scopeId: skillDefinitionId,
            payload: input.secret,
            createdBy: input.createdBy,
          },
          { tx },
        );
        secretRecordId = secretRecord.id;
      }

      const skillDefinition = await this.skillDefinitionRepository.createOne(
        {
          id: skillDefinitionId,
          workspaceId: input.workspaceId,
          name: input.name,
          runtimeKind: input.runtimeKind || 'isolated_python',
          sourceType: input.sourceType || 'inline',
          sourceRef: input.sourceRef ?? null,
          entrypoint: input.entrypoint ?? null,
          manifestJson: input.manifest ?? null,
          catalogId: input.catalogId ?? null,
          instruction: input.instruction ?? null,
          isEnabled: input.isEnabled ?? true,
          executionMode: normalizeSkillExecutionMode(),
          connectorId: input.connectorId ?? null,
          runtimeConfigJson: input.runtimeConfig ?? null,
          kbSuggestionIds: input.kbSuggestionIds ?? null,
          installedFrom: input.installedFrom ?? 'custom',
          migrationSourceBindingId: input.migrationSourceBindingId ?? null,
          secretRecordId,
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

      if (input.name !== undefined && input.name !== skillDefinition.name) {
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
      if (Object.prototype.hasOwnProperty.call(input, 'secret')) {
        if (input.secret) {
          if (skillDefinition.secretRecordId) {
            await this.secretService.updateSecretRecord(
              skillDefinition.secretRecordId,
              { payload: input.secret },
              { tx },
            );
          } else {
            const secretRecord = await this.secretService.createSecretRecord(
              {
                workspaceId: skillDefinition.workspaceId,
                scopeType: 'skill',
                scopeId: skillDefinition.id,
                payload: input.secret,
                createdBy: skillDefinition.createdBy,
              },
              { tx },
            );
            patch.secretRecordId = secretRecord.id;
          }
        } else if (skillDefinition.secretRecordId) {
          await this.secretService.deleteSecretRecord(
            skillDefinition.secretRecordId,
            { tx },
          );
          patch.secretRecordId = null;
        }
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
    return await this.skillDefinitionRepository.findOneBy({
      id: skillDefinitionId,
    });
  }

  public async resolveSkillSecret(
    skillDefinitionId: string,
  ): Promise<SecretPayload | null> {
    const skillDefinition =
      await this.getSkillDefinitionById(skillDefinitionId);
    if (!skillDefinition) {
      throw new Error(`Skill definition ${skillDefinitionId} not found`);
    }

    if (!skillDefinition.secretRecordId) {
      return null;
    }

    return await this.secretService.decryptSecretRecord(
      skillDefinition.secretRecordId,
    );
  }

  public async getResolvedSkillDefinition(
    skillDefinitionId: string,
  ): Promise<ResolvedSkillDefinition | null> {
    const skillDefinition =
      await this.getSkillDefinitionById(skillDefinitionId);
    if (!skillDefinition) {
      return null;
    }

    return {
      ...skillDefinition,
      secret: skillDefinition.secretRecordId
        ? await this.secretService.decryptSecretRecord(
            skillDefinition.secretRecordId,
          )
        : null,
    };
  }

  public async listSkillDefinitionsByWorkspace(
    workspaceId: string,
  ): Promise<SkillDefinition[]> {
    return await this.skillDefinitionRepository.findAllBy({ workspaceId });
  }

  public async listAvailableSkills(
    workspaceId: string,
  ): Promise<SkillDefinition[]> {
    return await this.skillDefinitionRepository.listAvailableSkillsByWorkspace(
      workspaceId,
    );
  }

  public async listMarketplaceCatalogSkills(): Promise<
    SkillMarketplaceCatalog[]
  > {
    return await this.skillMarketplaceCatalogRepository.findAll({
      order: 'name',
    });
  }

  public async installSkillFromMarketplace({
    workspaceId,
    catalogId,
    userId,
  }: {
    workspaceId: string;
    catalogId: string;
    userId?: string | null;
  }): Promise<SkillDefinition> {
    const tx = await this.skillDefinitionRepository.transaction();

    try {
      await this.ensureWorkspaceExists(workspaceId, { tx });
      const catalog = await this.skillMarketplaceCatalogRepository.findOneBy(
        { id: catalogId },
        { tx },
      );
      if (!catalog) {
        throw new Error(`Skill marketplace catalog ${catalogId} not found`);
      }

      const existingSkillDefinition =
        await this.skillDefinitionRepository.findOneBy(
          { workspaceId, catalogId },
          { tx },
        );
      if (existingSkillDefinition) {
        await this.skillDefinitionRepository.commit(tx);
        return existingSkillDefinition;
      }

      const skillDefinition = await this.skillDefinitionRepository.createOne(
        {
          id: crypto.randomUUID(),
          workspaceId,
          name: await this.reserveSkillName(workspaceId, catalog.name, {
            tx,
          }),
          runtimeKind: catalog.runtimeKind || 'isolated_python',
          sourceType: catalog.sourceType || 'marketplace',
          sourceRef: catalog.sourceRef ?? null,
          entrypoint: catalog.entrypoint ?? null,
          manifestJson: catalog.manifestJson ?? null,
          catalogId: catalog.id,
          instruction: catalog.defaultInstruction ?? null,
          isEnabled: true,
          executionMode: normalizeSkillExecutionMode(),
          connectorId: null,
          runtimeConfigJson: null,
          kbSuggestionIds: null,
          installedFrom: catalog.isBuiltin ? 'builtin' : 'marketplace',
          migrationSourceBindingId: null,
          secretRecordId: null,
          createdBy: userId ?? null,
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

  public async toggleSkillEnabled(
    workspaceId: string,
    skillDefinitionId: string,
    enabled: boolean,
  ): Promise<SkillDefinition> {
    const skillDefinition =
      await this.requireSkillDefinition(skillDefinitionId);
    if (skillDefinition.workspaceId !== workspaceId) {
      throw new Error(
        `Skill definition ${skillDefinitionId} does not belong to workspace ${workspaceId}`,
      );
    }

    return await this.skillDefinitionRepository.updateOne(skillDefinitionId, {
      isEnabled: enabled,
    });
  }

  public async updateSkillDefinitionRuntime(
    skillDefinitionId: string,
    input: UpdateSkillDefinitionRuntimeInput,
  ): Promise<SkillDefinition> {
    const tx = await this.skillDefinitionRepository.transaction();

    try {
      const skillDefinition = await this.requireSkillDefinition(
        skillDefinitionId,
        { tx },
      );

      if (Object.prototype.hasOwnProperty.call(input, 'connectorId')) {
        await this.ensureConnectorMatchesWorkspace(
          skillDefinition.workspaceId,
          input.connectorId,
          { tx },
        );
      }

      const patch: Partial<SkillDefinition> = {};
      if (Object.prototype.hasOwnProperty.call(input, 'instruction')) {
        patch.instruction = input.instruction ?? null;
      }
      if (input.isEnabled !== undefined) {
        patch.isEnabled = input.isEnabled;
      }
      if (input.executionMode !== undefined) {
        patch.executionMode = normalizeSkillExecutionMode();
      }
      if (Object.prototype.hasOwnProperty.call(input, 'connectorId')) {
        patch.connectorId = input.connectorId ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(input, 'runtimeConfig')) {
        patch.runtimeConfigJson = input.runtimeConfig ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(input, 'kbSuggestionIds')) {
        patch.kbSuggestionIds = input.kbSuggestionIds ?? null;
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
      if (skillDefinition.secretRecordId) {
        await this.secretService.deleteSecretRecord(
          skillDefinition.secretRecordId,
          { tx },
        );
      }
      await this.skillDefinitionRepository.commit(tx);
    } catch (error) {
      await this.skillDefinitionRepository.rollback(tx);
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
    const existingSkillDefinition =
      await this.skillDefinitionRepository.findOneBy(
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

  private async ensureConnectorMatchesWorkspace(
    workspaceId: string,
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
  }

  private async reserveSkillName(
    workspaceId: string,
    baseName: string,
    queryOptions?: IQueryOptions,
  ): Promise<string> {
    const normalizedBaseName = baseName.trim() || 'skill';
    let candidateName = normalizedBaseName;
    let attempt = 1;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const existingSkillDefinition =
        await this.skillDefinitionRepository.findOneBy(
          { workspaceId, name: candidateName },
          queryOptions,
        );
      if (!existingSkillDefinition) {
        return candidateName;
      }

      attempt += 1;
      candidateName = `${normalizedBaseName} (${attempt})`;
    }
  }
}
