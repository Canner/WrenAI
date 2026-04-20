import crypto from 'crypto';
import {
  IConnectorRepository,
  ISkillDefinitionRepository,
  ISkillMarketplaceCatalogRepository,
  IWorkspaceRepository,
  SkillDefinition,
  SkillMarketplaceCatalog,
} from '../repositories';
import { ISecretService, SecretPayload } from './secretService';
import {
  ensureConnectorMatchesWorkspace,
  ensureSkillNameAvailable,
  ensureWorkspaceExists,
  normalizeSkillExecutionMode,
  requireSkillDefinition,
  reserveSkillName,
} from './skillServiceSupport';
import type {
  CreateSkillDefinitionInput,
  ISkillService,
  ResolvedSkillDefinition,
  UpdateSkillDefinitionInput,
  UpdateSkillDefinitionRuntimeInput,
} from './skillServiceTypes';
export type {
  CreateSkillDefinitionInput,
  ISkillService,
  ResolvedSkillDefinition,
  UpdateSkillDefinitionInput,
  UpdateSkillDefinitionRuntimeInput,
} from './skillServiceTypes';

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
      await ensureWorkspaceExists(this.workspaceRepository, input.workspaceId, {
        tx,
      });
      await ensureSkillNameAvailable(
        this.skillDefinitionRepository,
        input.workspaceId,
        input.name,
        { tx },
      );
      await ensureConnectorMatchesWorkspace(
        this.connectorRepository,
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
        await ensureSkillNameAvailable(
          this.skillDefinitionRepository,
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
      await ensureWorkspaceExists(this.workspaceRepository, workspaceId, {
        tx,
      });
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
          name: await reserveSkillName(
            this.skillDefinitionRepository,
            workspaceId,
            catalog.name,
            { tx },
          ),
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
    const skillDefinition = await requireSkillDefinition(
      this.skillDefinitionRepository,
      skillDefinitionId,
    );
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
      const skillDefinition = await requireSkillDefinition(
        this.skillDefinitionRepository,
        skillDefinitionId,
        { tx },
      );

      if (Object.prototype.hasOwnProperty.call(input, 'connectorId')) {
        await ensureConnectorMatchesWorkspace(
          this.connectorRepository,
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
}
