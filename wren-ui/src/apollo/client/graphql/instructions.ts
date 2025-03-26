import { gql } from '@apollo/client';

const INSTRUCTION = gql`
  fragment Instruction on Instruction {
    id
    projectId
    instruction
    questions
    isDefault
    createdAt
    updatedAt
  }
`;

export const LIST_INSTRUCTIONS = gql`
  query Instructions {
    instructions {
      ...Instruction
    }
  }

  ${INSTRUCTION}
`;

export const CREATE_INSTRUCTION = gql`
  mutation CreateInstruction($data: CreateInstructionInput!) {
    createInstruction(data: $data) {
      ...Instruction
    }
  }

  ${INSTRUCTION}
`;

export const UPDATE_INSTRUCTION = gql`
  mutation UpdateInstruction(
    $where: InstructionWhereInput!
    $data: UpdateInstructionInput!
  ) {
    updateInstruction(where: $where, data: $data) {
      ...Instruction
    }
  }

  ${INSTRUCTION}
`;

export const DELETE_INSTRUCTION = gql`
  mutation DeleteInstruction($where: InstructionWhereInput!) {
    deleteInstruction(where: $where)
  }
`;
