import { gql } from '@apollo/client';

export const SKILL_CONTROL_PLANE = gql`
  query SkillControlPlane {
    runtimeSelectorState {
      currentWorkspace {
        id
        name
      }
      currentKnowledgeBase {
        id
        name
      }
      currentKbSnapshot {
        id
        displayName
      }
      kbSnapshots {
        id
        displayName
      }
    }
    marketplaceCatalogSkills {
      id
      slug
      name
      description
      category
      author
      version
      runtimeKind
      sourceType
      sourceRef
      entrypoint
      defaultInstruction
      defaultExecutionMode
      manifest
      isBuiltin
      isFeatured
      installCount
    }
    skillDefinitions {
      id
      workspaceId
      name
      runtimeKind
      sourceType
      sourceRef
      entrypoint
      catalogId
      instruction
      isEnabled
      executionMode
      connectorId
      runtimeConfig
      kbSuggestionIds
      installedFrom
      migrationSourceBindingId
      manifest
      hasSecret
      createdBy
    }
  }
`;

export const CREATE_SKILL_DEFINITION = gql`
  mutation CreateSkillDefinition($data: CreateSkillDefinitionInput!) {
    createSkillDefinition(data: $data) {
      id
    }
  }
`;

export const UPDATE_SKILL_DEFINITION = gql`
  mutation UpdateSkillDefinition(
    $where: SkillDefinitionWhereUniqueInput!
    $data: UpdateSkillDefinitionInput!
  ) {
    updateSkillDefinition(where: $where, data: $data) {
      id
    }
  }
`;

export const DELETE_SKILL_DEFINITION = gql`
  mutation DeleteSkillDefinition($where: SkillDefinitionWhereUniqueInput!) {
    deleteSkillDefinition(where: $where)
  }
`;

export const INSTALL_SKILL_FROM_MARKETPLACE = gql`
  mutation InstallSkillFromMarketplace($catalogId: String!) {
    installSkillFromMarketplace(catalogId: $catalogId) {
      id
    }
  }
`;

export const TOGGLE_SKILL_ENABLED = gql`
  mutation ToggleSkillEnabled($skillDefinitionId: String!, $enabled: Boolean!) {
    toggleSkillEnabled(
      skillDefinitionId: $skillDefinitionId
      enabled: $enabled
    ) {
      id
      isEnabled
    }
  }
`;

export const UPDATE_SKILL_DEFINITION_RUNTIME = gql`
  mutation UpdateSkillDefinitionRuntime(
    $where: SkillDefinitionWhereUniqueInput!
    $data: UpdateSkillDefinitionRuntimeInput!
  ) {
    updateSkillDefinitionRuntime(where: $where, data: $data) {
      id
    }
  }
`;
