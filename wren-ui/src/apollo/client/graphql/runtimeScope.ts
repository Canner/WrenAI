import { gql } from '@apollo/client';

export const RUNTIME_SELECTOR_STATE = gql`
  query RuntimeSelectorState {
    runtimeSelectorState {
      currentProjectId
      currentWorkspace {
        id
        slug
        name
      }
      currentKnowledgeBase {
        id
        slug
        name
        defaultKbSnapshotId
      }
      currentKbSnapshot {
        id
        snapshotKey
        displayName
        deployHash
        status
      }
      knowledgeBases {
        id
        slug
        name
        defaultKbSnapshotId
      }
      kbSnapshots {
        id
        snapshotKey
        displayName
        deployHash
        status
      }
    }
  }
`;
