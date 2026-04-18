import {
  buildRuntimeScopeUrl,
  type ClientRuntimeScopeSelector,
} from '@/runtime/client/runtimeScope';

export type SkillDefinitionView = {
  id: string;
  workspaceId: string;
  name: string;
  runtimeKind: string;
  sourceType: string;
  sourceRef?: string | null;
  entrypoint?: string | null;
  catalogId?: string | null;
  instruction?: string | null;
  isEnabled?: boolean | null;
  executionMode?: 'inject_only' | null;
  connectorId?: string | null;
  runtimeConfig?: Record<string, any> | null;
  kbSuggestionIds?: string[] | null;
  installedFrom?: string | null;
  migrationSourceBindingId?: string | null;
  manifest?: Record<string, any> | null;
  hasSecret?: boolean;
  createdBy?: string | null;
};

export type SkillMarketplaceCatalogView = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  category?: string | null;
  author?: string | null;
  version: string;
  runtimeKind: string;
  sourceType: string;
  sourceRef?: string | null;
  entrypoint?: string | null;
  defaultInstruction?: string | null;
  defaultExecutionMode?: 'inject_only' | null;
  manifest?: Record<string, any> | null;
  isBuiltin?: boolean | null;
  isFeatured?: boolean | null;
  installCount?: number | null;
};

export type SkillDefinitionMutationPayload = {
  name?: string;
  runtimeKind?: string;
  sourceType?: string;
  sourceRef?: string | null;
  entrypoint?: string | null;
  manifest?: Record<string, any> | null;
  secret?: Record<string, any> | null;
  instruction?: string | null;
  executionMode?: 'inject_only';
  connectorId?: string | null;
  isEnabled?: boolean;
  runtimeConfig?: Record<string, any> | null;
  kbSuggestionIds?: string[] | null;
};

const buildSkillsCollectionUrl = (selector: ClientRuntimeScopeSelector) =>
  buildRuntimeScopeUrl('/api/v1/skills', {}, selector);

const buildSkillItemUrl = (id: string, selector: ClientRuntimeScopeSelector) =>
  buildRuntimeScopeUrl(`/api/v1/skills/${id}`, {}, selector);

const buildSkillMarketplaceUrl = (selector: ClientRuntimeScopeSelector) =>
  buildRuntimeScopeUrl('/api/v1/skills/marketplace', {}, selector);

const parseSkillRestResponse = async <TPayload>(
  response: Response,
  fallbackMessage: string,
): Promise<TPayload> => {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(
      (payload as { error?: string } | null)?.error || fallbackMessage,
    );
  }

  return payload as TPayload;
};

export const listSkillDefinitions = async (
  selector: ClientRuntimeScopeSelector,
  init?: RequestInit,
) => {
  const response = await fetch(buildSkillsCollectionUrl(selector), init);
  return await parseSkillRestResponse<SkillDefinitionView[]>(
    response,
    '加载技能失败，请稍后重试。',
  );
};

export const listSkillMarketplaceCatalog = async (
  selector: ClientRuntimeScopeSelector,
  init?: RequestInit,
) => {
  const response = await fetch(buildSkillMarketplaceUrl(selector), init);
  return await parseSkillRestResponse<SkillMarketplaceCatalogView[]>(
    response,
    '加载技能市场失败，请稍后重试。',
  );
};

export const createSkillDefinitionRecord = async (
  selector: ClientRuntimeScopeSelector,
  data: SkillDefinitionMutationPayload,
) => {
  const response = await fetch(buildSkillsCollectionUrl(selector), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  return await parseSkillRestResponse<SkillDefinitionView>(
    response,
    '创建技能失败，请稍后重试。',
  );
};

export const updateSkillDefinitionRecord = async (
  selector: ClientRuntimeScopeSelector,
  id: string,
  data: SkillDefinitionMutationPayload,
) => {
  const response = await fetch(buildSkillItemUrl(id, selector), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  return await parseSkillRestResponse<SkillDefinitionView>(
    response,
    '更新技能失败，请稍后重试。',
  );
};

export const deleteSkillDefinitionRecord = async (
  selector: ClientRuntimeScopeSelector,
  id: string,
) => {
  const response = await fetch(buildSkillItemUrl(id, selector), {
    method: 'DELETE',
  });

  await parseSkillRestResponse<null>(response, '删除技能失败，请稍后重试。');
};

export const installSkillMarketplaceCatalog = async (
  selector: ClientRuntimeScopeSelector,
  catalogId: string,
) => {
  const response = await fetch(buildSkillMarketplaceUrl(selector), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ catalogId }),
  });

  return await parseSkillRestResponse<SkillDefinitionView>(
    response,
    '安装技能失败，请稍后重试。',
  );
};
