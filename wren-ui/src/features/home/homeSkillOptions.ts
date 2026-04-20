import { buildRuntimeScopeUrl } from '@/runtime/client/runtimeScope';

export type HomeSkillDefinitionSummary = {
  id: string;
  name: string;
  runtimeKind?: string | null;
  sourceType?: string | null;
  connectorId?: string | null;
  kbSuggestionIds?: string[] | null;
};

export type HomeSkillOption = {
  id: string;
  name: string;
  runtimeKind?: string | null;
  sourceType?: string | null;
  knowledgeBaseIds: string[];
  connectorCount: number;
};

const HOME_SKILL_OPTIONS_STORAGE_PREFIX = 'wren.homeSkillOptions';
const HOME_SKILL_OPTIONS_CACHE_TTL_MS = 2 * 60 * 1000;

type HomeSkillOptionsCacheRecord = {
  value: HomeSkillOption[];
  updatedAt: number;
};

const getHomeSkillOptionsStorage = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch (_error) {
    return null;
  }
};

const buildHomeSkillOptionsStorageKey = (workspaceId: string) =>
  `${HOME_SKILL_OPTIONS_STORAGE_PREFIX}:${workspaceId}`;

export const clearHomeSkillOptionsCacheForTests = () => {
  const storage = getHomeSkillOptionsStorage();
  if (!storage) {
    return;
  }

  const keysToRemove: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(HOME_SKILL_OPTIONS_STORAGE_PREFIX)) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach((key) => storage.removeItem(key));
};

export const normalizeHomeSkillOptions = (
  skills: HomeSkillDefinitionSummary[],
): HomeSkillOption[] =>
  skills
    .map((skill) => {
      const knowledgeBaseIds = skill.kbSuggestionIds || [];
      return {
        id: skill.id,
        name: skill.name,
        runtimeKind: skill.runtimeKind,
        sourceType: skill.sourceType,
        knowledgeBaseIds,
        connectorCount: skill.connectorId ? 1 : 0,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));

export const getCachedHomeSkillOptions = (workspaceId?: string | null) => {
  if (!workspaceId) {
    return null;
  }

  const storage = getHomeSkillOptionsStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(buildHomeSkillOptionsStorageKey(workspaceId));
    if (!raw) {
      return null;
    }

    const cached = JSON.parse(raw) as HomeSkillOptionsCacheRecord;
    if (Date.now() - cached.updatedAt > HOME_SKILL_OPTIONS_CACHE_TTL_MS) {
      storage.removeItem(buildHomeSkillOptionsStorageKey(workspaceId));
      return null;
    }

    return cached.value;
  } catch (_error) {
    storage.removeItem(buildHomeSkillOptionsStorageKey(workspaceId));
    return null;
  }
};

const cacheHomeSkillOptions = (
  workspaceId: string,
  options: HomeSkillOption[],
) => {
  const storage = getHomeSkillOptionsStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      buildHomeSkillOptionsStorageKey(workspaceId),
      JSON.stringify({
        value: options,
        updatedAt: Date.now(),
      } satisfies HomeSkillOptionsCacheRecord),
    );
  } catch (_error) {
    // ignore storage write failures in restricted browsers
  }
};

export const fetchHomeSkillOptions = async (workspaceId: string) => {
  const cachedOptions = getCachedHomeSkillOptions(workspaceId);
  if (cachedOptions) {
    return cachedOptions;
  }

  const response = await fetch(
    buildRuntimeScopeUrl('/api/v1/skills/available', {}, { workspaceId }),
  );

  if (!response.ok) {
    throw new Error(`Failed to load skills (${response.status})`);
  }

  const skills = (await response.json()) as HomeSkillDefinitionSummary[];
  const normalizedSkills = normalizeHomeSkillOptions(skills);
  cacheHomeSkillOptions(workspaceId, normalizedSkills);
  return normalizedSkills;
};

export const shouldLoadHomeSkillOptions = ({
  workspaceId,
  hasExecutableRuntime,
  skillPickerOpen,
  selectedSkillCount,
}: {
  workspaceId?: string | null;
  hasExecutableRuntime: boolean;
  skillPickerOpen: boolean;
  selectedSkillCount: number;
}) =>
  Boolean(
    workspaceId &&
    hasExecutableRuntime &&
    (skillPickerOpen || selectedSkillCount > 0),
  );
