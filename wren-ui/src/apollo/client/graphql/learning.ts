import { gql } from '@apollo/client';

export const LEARNING_RECORD = gql`
  query LearningRecord {
    learningRecord {
      paths
    }
  }
`;

export const SAVE_LEARNING_RECORD = gql`
  mutation SaveLearningRecord($data: SaveLearningRecordInput!) {
    saveLearningRecord(data: $data) {
      paths
    }
  }
`;
