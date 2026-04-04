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
    skillDefinitions {
      id
      workspaceId
      name
      runtimeKind
      sourceType
      sourceRef
      entrypoint
      manifest
      createdBy
    }
    skillBindings {
      id
      knowledgeBaseId
      kbSnapshotId
      skillDefinitionId
      connectorId
      bindingConfig
      enabled
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

export const CREATE_SKILL_BINDING = gql`
  mutation CreateSkillBinding($data: CreateSkillBindingInput!) {
    createSkillBinding(data: $data) {
      id
    }
  }
`;

export const UPDATE_SKILL_BINDING = gql`
  mutation UpdateSkillBinding(
    $where: SkillBindingWhereUniqueInput!
    $data: UpdateSkillBindingInput!
  ) {
    updateSkillBinding(where: $where, data: $data) {
      id
    }
  }
`;

export const DELETE_SKILL_BINDING = gql`
  mutation DeleteSkillBinding($where: SkillBindingWhereUniqueInput!) {
    deleteSkillBinding(where: $where)
  }
`;
