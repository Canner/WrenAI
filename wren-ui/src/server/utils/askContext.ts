import {
  AskInput,
  AskRuntimeIdentity,
  AskSkillCandidate,
} from '@server/models/adaptor';
import { ISkillService } from '@server/services/skillService';
import { SkillDefinition } from '@server/repositories';

interface BuildAskRuntimeContextOptions {
  runtimeIdentity?: AskRuntimeIdentity | null;
  knowledgeBaseIds?: string[] | null;
  selectedSkillIds?: string[] | null;
  skillService?: Pick<ISkillService, 'getSkillDefinitionById'> | null;
}

type ResolvedSkill = SkillDefinition & {
  instruction?: string | null;
};

type AskRuntimeIdentitySource = {
  [K in keyof AskRuntimeIdentity]?: AskRuntimeIdentity[K] | null;
};

export const toAskRuntimeIdentity = (
  runtimeIdentity?: AskRuntimeIdentitySource | null,
): AskRuntimeIdentity | undefined => {
  if (!runtimeIdentity?.workspaceId || !runtimeIdentity?.knowledgeBaseId) {
    return undefined;
  }

  return {
    projectId: runtimeIdentity.projectId ?? undefined,
    workspaceId: runtimeIdentity.workspaceId,
    knowledgeBaseId: runtimeIdentity.knowledgeBaseId,
    kbSnapshotId: runtimeIdentity.kbSnapshotId || null,
    deployHash: runtimeIdentity.deployHash || null,
    actorUserId: runtimeIdentity.actorUserId || null,
  };
};

const normalizeIds = (values?: Array<string | null | undefined> | null) =>
  Array.from(
    new Set(
      (values || []).map((value) => `${value || ''}`.trim()).filter(Boolean),
    ),
  );

const normalizeInstruction = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
};

const getConfigInstruction = (
  config?: Record<string, any> | null,
): string | null => normalizeInstruction(config?.instruction);

const resolveSkillInstruction = (
  definition: SkillDefinition & {
    instruction?: string | null;
    runtimeConfigJson?: Record<string, any> | null;
  },
) =>
  normalizeInstruction(definition.instruction) ||
  getConfigInstruction(definition.runtimeConfigJson) ||
  getConfigInstruction(definition.manifestJson);

export const toAskSkillCandidate = (
  definition: SkillDefinition & {
    instruction?: string | null;
    runtimeConfigJson?: Record<string, any> | null;
  },
): AskSkillCandidate => ({
  skillId: definition.id,
  skillName: definition.name,
  instruction: resolveSkillInstruction(definition),
  executionMode: 'inject_only',
});

export const buildAskRuntimeContext = async ({
  runtimeIdentity,
  knowledgeBaseIds: _knowledgeBaseIds,
  selectedSkillIds,
  skillService,
}: BuildAskRuntimeContextOptions): Promise<Partial<AskInput>> => {
  const askRuntimeIdentity = toAskRuntimeIdentity(runtimeIdentity);
  const normalizedSelectedSkillIds = normalizeIds(selectedSkillIds);
  const shouldSkipSkillResolution = normalizedSelectedSkillIds.length === 0;

  if (!askRuntimeIdentity || !skillService || shouldSkipSkillResolution) {
    return {
      runtimeIdentity: askRuntimeIdentity,
      ...(shouldSkipSkillResolution
        ? {
            skills: [],
          }
        : {}),
    };
  }

  try {
    const definitionResults = await Promise.allSettled(
      normalizedSelectedSkillIds.map((skillDefinitionId) =>
        skillService.getSkillDefinitionById(skillDefinitionId),
      ),
    );

    const resolvedDefinitions = definitionResults
      .filter(
        (result): result is PromiseFulfilledResult<SkillDefinition | null> =>
          result.status === 'fulfilled',
      )
      .map((result) => result.value)
      .filter((definition): definition is ResolvedSkill => {
        if (!definition) {
          return false;
        }

        return (
          definition.workspaceId === askRuntimeIdentity.workspaceId &&
          definition.isEnabled !== false
        );
      });

    return {
      runtimeIdentity: askRuntimeIdentity,
      skills: resolvedDefinitions.map((definition) =>
        toAskSkillCandidate(definition),
      ),
    };
  } catch {
    return {
      runtimeIdentity: askRuntimeIdentity,
      skills: [],
    };
  }
};
