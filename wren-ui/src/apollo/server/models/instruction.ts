export interface InstructionInput {
  projectId: number;
  instruction: string;
  questions: string[];
  isDefault: boolean;
}

export interface UpdateInstructionInput {
  id: number;
  projectId: number;
  instruction: string;
  questions: string[];
  isDefault: boolean;
}
