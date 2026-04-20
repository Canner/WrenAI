import type {
  IConnectorRepository,
  IQueryOptions,
  ISkillDefinitionRepository,
  IWorkspaceRepository,
  SkillDefinition,
  SkillExecutionMode,
} from '../repositories';

export const normalizeSkillExecutionMode = (): SkillExecutionMode =>
  'inject_only';

export const ensureWorkspaceExists = async (
  workspaceRepository: IWorkspaceRepository,
  workspaceId: string,
  queryOptions?: IQueryOptions,
) => {
  const workspace = await workspaceRepository.findOneBy(
    { id: workspaceId },
    queryOptions,
  );
  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} not found`);
  }
};

export const ensureSkillNameAvailable = async (
  skillDefinitionRepository: ISkillDefinitionRepository,
  workspaceId: string,
  name: string,
  queryOptions?: IQueryOptions,
  currentSkillDefinitionId?: string,
) => {
  const existingSkillDefinition = await skillDefinitionRepository.findOneBy(
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
};

export const requireSkillDefinition = async (
  skillDefinitionRepository: ISkillDefinitionRepository,
  skillDefinitionId: string,
  queryOptions?: IQueryOptions,
): Promise<SkillDefinition> => {
  const skillDefinition = await skillDefinitionRepository.findOneBy(
    { id: skillDefinitionId },
    queryOptions,
  );
  if (!skillDefinition) {
    throw new Error(`Skill definition ${skillDefinitionId} not found`);
  }
  return skillDefinition;
};

export const ensureConnectorMatchesWorkspace = async (
  connectorRepository: IConnectorRepository,
  workspaceId: string,
  connectorId?: string | null,
  queryOptions?: IQueryOptions,
) => {
  if (!connectorId) {
    return;
  }

  const connector = await connectorRepository.findOneBy(
    { id: connectorId },
    queryOptions,
  );
  if (!connector || connector.workspaceId !== workspaceId) {
    throw new Error(
      `Connector ${connectorId} does not belong to workspace ${workspaceId}`,
    );
  }
};

export const reserveSkillName = async (
  skillDefinitionRepository: ISkillDefinitionRepository,
  workspaceId: string,
  baseName: string,
  queryOptions?: IQueryOptions,
): Promise<string> => {
  const normalizedBaseName = baseName.trim() || 'skill';
  let candidateName = normalizedBaseName;
  let attempt = 1;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existingSkillDefinition = await skillDefinitionRepository.findOneBy(
      { workspaceId, name: candidateName },
      queryOptions,
    );
    if (!existingSkillDefinition) {
      return candidateName;
    }

    attempt += 1;
    candidateName = `${normalizedBaseName} (${attempt})`;
  }
};
