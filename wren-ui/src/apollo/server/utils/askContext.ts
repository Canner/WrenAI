import {
  AskActorClaims,
  AskInput,
  AskRuntimeIdentity,
  AskSkillCandidate,
  AskSkillConnector,
  AskSkillSecret,
} from '@server/models/adaptor';
import { ActorClaims } from '@server/services/authService';
import { IConnectorService } from '@server/services/connectorService';
import { ISkillService } from '@server/services/skillService';
import { SkillBinding, SkillDefinition } from '@server/repositories';

interface BuildAskRuntimeContextOptions {
  runtimeIdentity?: AskRuntimeIdentity | null;
  actorClaims?: ActorClaims | null;
  skillService?: Pick<
    ISkillService,
    'listSkillBindingsByKnowledgeBase' | 'getSkillDefinitionById'
  > | null;
  connectorService?: Pick<IConnectorService, 'getResolvedConnector'> | null;
}

const toAskActorClaims = (
  actorClaims?: ActorClaims | null,
): AskActorClaims | undefined => {
  if (!actorClaims) {
    return undefined;
  }

  return {
    userId: actorClaims.userId,
    workspaceMemberId: actorClaims.workspaceMemberId,
    roleKeys: actorClaims.roleKeys,
    permissionScopes: actorClaims.permissionScopes,
  };
};

const toAskRuntimeIdentity = (
  runtimeIdentity?: AskRuntimeIdentity | null,
): AskRuntimeIdentity | undefined => {
  if (!runtimeIdentity?.workspaceId || !runtimeIdentity?.knowledgeBaseId) {
    return undefined;
  }

  return {
    projectId: runtimeIdentity.projectId,
    workspaceId: runtimeIdentity.workspaceId,
    knowledgeBaseId: runtimeIdentity.knowledgeBaseId,
    kbSnapshotId: runtimeIdentity.kbSnapshotId || null,
    deployHash: runtimeIdentity.deployHash || null,
    actorUserId: runtimeIdentity.actorUserId || null,
  };
};

const isBindingApplicable = (
  binding: SkillBinding,
  runtimeIdentity?: AskRuntimeIdentity | null,
) => {
  if (!binding.enabled) {
    return false;
  }

  if (!binding.kbSnapshotId) {
    return true;
  }

  return Boolean(
    runtimeIdentity?.kbSnapshotId &&
      binding.kbSnapshotId === runtimeIdentity.kbSnapshotId,
  );
};

const toAskSkillCandidate = (
  definition: SkillDefinition,
  binding: SkillBinding,
): AskSkillCandidate => ({
  skillId: definition.id,
  skillName: definition.name,
  runtimeKind: definition.runtimeKind,
  sourceType: definition.sourceType,
  sourceRef: definition.sourceRef || null,
  entrypoint: definition.entrypoint || null,
  skillConfig: binding.bindingConfig || {},
});

const toAskSkillConnector = (connector: {
  id: string;
  type: string;
  displayName: string;
  configJson?: Record<string, any> | null;
  workspaceId: string;
  knowledgeBaseId?: string | null;
  secretRecordId?: string | null;
}): AskSkillConnector => ({
  id: connector.id,
  type: connector.type,
  displayName: connector.displayName,
  config: connector.configJson || {},
  metadata: {
    workspaceId: connector.workspaceId,
    knowledgeBaseId: connector.knowledgeBaseId || null,
    secretRecordId: connector.secretRecordId || null,
  },
});

const toAskSkillSecret = (connector: {
  id: string;
  displayName: string;
  secretRecordId?: string | null;
  secret: Record<string, any> | null;
}): AskSkillSecret | null => {
  if (!connector.secret) {
    return null;
  }

  return {
    id: connector.secretRecordId || connector.id,
    name: connector.displayName,
    values: connector.secret,
    redactedKeys: Object.keys(connector.secret),
  };
};

export const buildAskRuntimeContext = async ({
  runtimeIdentity,
  actorClaims,
  skillService,
  connectorService,
}: BuildAskRuntimeContextOptions): Promise<Partial<AskInput>> => {
  const askRuntimeIdentity = toAskRuntimeIdentity(runtimeIdentity);
  const askActorClaims = toAskActorClaims(actorClaims);

  if (!askRuntimeIdentity || !skillService) {
    return {
      runtimeIdentity: askRuntimeIdentity,
      actorClaims: askActorClaims,
    };
  }

  try {
    const bindings = await skillService.listSkillBindingsByKnowledgeBase(
      askRuntimeIdentity.knowledgeBaseId!,
    );
    const applicableBindings = bindings.filter((binding) =>
      isBindingApplicable(binding, runtimeIdentity),
    );

    const definitionResults = await Promise.allSettled(
      applicableBindings.map(async (binding) => ({
        binding,
        definition: await skillService.getSkillDefinitionById(
          binding.skillDefinitionId,
        ),
      })),
    );

    const resolvedDefinitions = definitionResults
      .filter(
        (
          result,
        ): result is PromiseFulfilledResult<{
          binding: SkillBinding;
          definition: SkillDefinition | null;
        }> => result.status === 'fulfilled',
      )
      .map((result) => result.value)
      .filter((result) => result.definition);

    const skills = resolvedDefinitions.map(({ binding, definition }) =>
      toAskSkillCandidate(definition!, binding),
    );

    if (!connectorService) {
      return {
        runtimeIdentity: askRuntimeIdentity,
        actorClaims: askActorClaims,
        skills,
      };
    }

    const connectorIds = Array.from(
      new Set(
        applicableBindings
          .map((binding) => binding.connectorId)
          .filter((connectorId): connectorId is string => Boolean(connectorId)),
      ),
    );

    const connectorResults = await Promise.allSettled(
      connectorIds.map((connectorId) => connectorService.getResolvedConnector(connectorId)),
    );

    const resolvedConnectors = connectorResults
      .filter(
        (
          result,
        ): result is PromiseFulfilledResult<Awaited<ReturnType<IConnectorService['getResolvedConnector']>>> =>
          result.status === 'fulfilled',
      )
      .map((result) => result.value)
      .filter(Boolean);

    const connectors = resolvedConnectors.map((connector) =>
      toAskSkillConnector(connector),
    );
    const secrets = resolvedConnectors
      .map((connector) => toAskSkillSecret(connector))
      .filter((secret): secret is AskSkillSecret => Boolean(secret));

    return {
      runtimeIdentity: askRuntimeIdentity,
      actorClaims: askActorClaims,
      skills,
      connectors,
      secrets,
    };
  } catch {
    return {
      runtimeIdentity: askRuntimeIdentity,
      actorClaims: askActorClaims,
    };
  }
};
