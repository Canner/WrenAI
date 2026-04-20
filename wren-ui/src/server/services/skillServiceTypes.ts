import type {
  SkillDefinition,
  SkillExecutionMode,
  SkillInstalledFrom,
  SkillMarketplaceCatalog,
} from '../repositories';
import type { SecretPayload } from './secretService';

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

export interface ResolvedSkillDefinition extends SkillDefinition {
  secret: SecretPayload | null;
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
