import { ApiError } from '@/server/utils/apiUtils';

export const validateSkillId = (id: any): string => {
  if (!id || typeof id !== 'string') {
    throw new ApiError('Skill ID is required', 400);
  }

  return id;
};

export interface SkillRuntimeMutationRequest {
  instruction?: string | null;
  isEnabled?: boolean;
  executionMode?: 'inject_only';
  connectorId?: string | null;
  runtimeConfig?: Record<string, any> | null;
  kbSuggestionIds?: string[] | null;
}

export const validateSkillRuntimePayload = (
  payload: SkillRuntimeMutationRequest,
) => {
  if (
    payload.instruction !== undefined &&
    payload.instruction !== null &&
    typeof payload.instruction !== 'string'
  ) {
    throw new ApiError('Skill instruction must be a string', 400);
  }

  if (
    payload.isEnabled !== undefined &&
    typeof payload.isEnabled !== 'boolean'
  ) {
    throw new ApiError('Skill isEnabled must be a boolean', 400);
  }

  if (
    payload.executionMode !== undefined &&
    payload.executionMode !== 'inject_only'
  ) {
    throw new ApiError('Skill executionMode must be inject_only', 400);
  }

  if (
    payload.connectorId !== undefined &&
    payload.connectorId !== null &&
    typeof payload.connectorId !== 'string'
  ) {
    throw new ApiError('Skill connectorId must be a string', 400);
  }

  if (
    payload.runtimeConfig !== undefined &&
    payload.runtimeConfig !== null &&
    (typeof payload.runtimeConfig !== 'object' ||
      Array.isArray(payload.runtimeConfig))
  ) {
    throw new ApiError('Skill runtimeConfig must be an object', 400);
  }

  if (
    payload.kbSuggestionIds !== undefined &&
    payload.kbSuggestionIds !== null &&
    (!Array.isArray(payload.kbSuggestionIds) ||
      payload.kbSuggestionIds.some(
        (knowledgeBaseId) => typeof knowledgeBaseId !== 'string',
      ))
  ) {
    throw new ApiError('Skill kbSuggestionIds must be a string array', 400);
  }
};

export const hasSkillRuntimePayload = (payload: SkillRuntimeMutationRequest) =>
  [
    'instruction',
    'isEnabled',
    'executionMode',
    'connectorId',
    'runtimeConfig',
    'kbSuggestionIds',
  ].some((key) => Object.prototype.hasOwnProperty.call(payload, key));

export const toSkillRuntimeInput = (payload: SkillRuntimeMutationRequest) => ({
  ...(Object.prototype.hasOwnProperty.call(payload, 'instruction')
    ? { instruction: payload.instruction?.trim() || null }
    : {}),
  ...(Object.prototype.hasOwnProperty.call(payload, 'isEnabled')
    ? { isEnabled: payload.isEnabled }
    : {}),
  ...(Object.prototype.hasOwnProperty.call(payload, 'executionMode')
    ? payload.executionMode
      ? { executionMode: payload.executionMode }
      : {}
    : {}),
  ...(Object.prototype.hasOwnProperty.call(payload, 'connectorId')
    ? { connectorId: payload.connectorId?.trim() || null }
    : {}),
  ...(Object.prototype.hasOwnProperty.call(payload, 'runtimeConfig')
    ? { runtimeConfig: payload.runtimeConfig ?? null }
    : {}),
  ...(Object.prototype.hasOwnProperty.call(payload, 'kbSuggestionIds')
    ? { kbSuggestionIds: payload.kbSuggestionIds ?? null }
    : {}),
});

export const toSkillResponse = (skillDefinition: any) => ({
  id: skillDefinition.id,
  workspaceId: skillDefinition.workspaceId,
  name: skillDefinition.name,
  runtimeKind: skillDefinition.runtimeKind,
  sourceType: skillDefinition.sourceType,
  sourceRef: skillDefinition.sourceRef ?? null,
  entrypoint: skillDefinition.entrypoint ?? null,
  catalogId: skillDefinition.catalogId ?? null,
  instruction: skillDefinition.instruction ?? null,
  isEnabled: skillDefinition.isEnabled ?? true,
  executionMode: 'inject_only',
  connectorId: skillDefinition.connectorId ?? null,
  runtimeConfig: skillDefinition.runtimeConfigJson ?? null,
  kbSuggestionIds: skillDefinition.kbSuggestionIds ?? null,
  installedFrom: skillDefinition.installedFrom ?? 'custom',
  migrationSourceBindingId: skillDefinition.migrationSourceBindingId ?? null,
  manifest: skillDefinition.manifestJson ?? null,
  hasSecret: Boolean(skillDefinition.secretRecordId),
  createdBy: skillDefinition.createdBy ?? null,
});

export const toSkillMarketplaceCatalogResponse = (catalog: any) => ({
  id: catalog.id,
  slug: catalog.slug,
  name: catalog.name,
  description: catalog.description ?? null,
  category: catalog.category ?? null,
  author: catalog.author ?? null,
  version: catalog.version,
  runtimeKind: catalog.runtimeKind,
  sourceType: catalog.sourceType,
  sourceRef: catalog.sourceRef ?? null,
  entrypoint: catalog.entrypoint ?? null,
  defaultInstruction: catalog.defaultInstruction ?? null,
  defaultExecutionMode: 'inject_only',
  manifest: catalog.manifestJson ?? null,
  isBuiltin: catalog.isBuiltin ?? false,
  isFeatured: catalog.isFeatured ?? false,
  installCount: catalog.installCount ?? 0,
});
