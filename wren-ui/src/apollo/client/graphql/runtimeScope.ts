import { gql } from '@apollo/client';

export const RUNTIME_SELECTOR_STATE = gql`
  query RuntimeSelectorState {
    runtimeSelectorState {
      currentWorkspace {
        id
        slug
        name
        kind
      }
      workspaces {
        id
        slug
        name
      }
      currentKnowledgeBase {
        id
        slug
        name
        kind
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
