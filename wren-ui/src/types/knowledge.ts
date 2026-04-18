export type CreateInstructionInput = {
  instruction: string;
  isDefault: boolean;
  questions: string[];
};

export type CreateSqlPairInput = {
  question: string;
  sql: string;
};

export type Instruction = {
  __typename?: 'Instruction';
  createdAt: string;
  id: number;
  instruction: string;
  isDefault: boolean;
  questions: string[];
  updatedAt: string;
};

export type SqlPair = {
  __typename?: 'SqlPair';
  createdAt?: string | null;
  id: number;
  question: string;
  sql: string;
  updatedAt?: string | null;
};
