export interface InstructionInput {
  instruction: string;
  questions: string[];
  isDefault: boolean;
}

export interface UpdateInstructionInput {
  id: number;
  instruction: string;
  questions: string[];
  isDefault: boolean;
}
