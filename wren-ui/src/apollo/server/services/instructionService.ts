import { merge, pick } from 'lodash';
import { IWrenAIAdaptor } from '../adaptors';
import { InstructionInput, UpdateInstructionInput } from '../models';
import {
  InstructionResult,
  InstructionStatus,
  GenerateInstructionInput,
} from '../models/adaptor';
import {
  IInstructionRepository,
  Instruction,
} from '../repositories/instructionRepository';
import * as Errors from '@server/utils/error';
export interface IInstructionService {
  getInstructions(projectId: number): Promise<Instruction[]>;
  createInstruction(instruction: InstructionInput): Promise<Instruction>;
  createInstructions(instructions: InstructionInput[]): Promise<Instruction[]>;
  updateInstruction(instruction: UpdateInstructionInput): Promise<Instruction>;
  deleteInstruction(id: number): Promise<void>;
}

export class InstructionService implements IInstructionService {
  private readonly instructionRepository: IInstructionRepository;
  private readonly wrenAIAdaptor: IWrenAIAdaptor;
  constructor({
    instructionRepository,
    wrenAIAdaptor,
  }: {
    instructionRepository: IInstructionRepository;
    wrenAIAdaptor: IWrenAIAdaptor;
  }) {
    this.instructionRepository = instructionRepository;
    this.wrenAIAdaptor = wrenAIAdaptor;
  }
  public async getInstructions(projectId: number): Promise<Instruction[]> {
    return this.instructionRepository.findAllBy({ projectId });
  }

  public async createInstruction(
    input: InstructionInput,
  ): Promise<Instruction> {
    const tx = await this.instructionRepository.transaction();
    try {
      this.validateInstructionInput(input);
      const newInstruction = await this.instructionRepository.createOne(input, {
        tx,
      });
      const { queryId } = await this.wrenAIAdaptor.generateInstruction([
        this.pickGenerateInstructionInput(newInstruction),
      ]);
      const res = await this.waitDeployInstruction(queryId);
      if (res.error) {
        await tx.rollback();
        throw Errors.create(res.error.code, {
          customMessage: res.error.message,
        });
      }
      await tx.commit();
      return newInstruction;
    } catch (e: any) {
      await tx.rollback();
      throw new Error(`Failed to create instruction: ${e}`);
    }
  }

  public async createInstructions(
    inputs: InstructionInput[],
  ): Promise<Instruction[]> {
    const tx = await this.instructionRepository.transaction();
    try {
      inputs.forEach((input) => this.validateInstructionInput(input));
      const newInstructions = await this.instructionRepository.createMany(
        inputs,
        {
          tx,
        },
      );
      const { queryId } = await this.wrenAIAdaptor.generateInstruction(
        newInstructions.map(this.pickGenerateInstructionInput),
      );
      const res = await this.waitDeployInstruction(queryId);
      if (res.error) {
        await tx.rollback();
        throw Errors.create(res.error.code, {
          customMessage: res.error.message,
        });
      }
      await tx.commit();
      return newInstructions;
    } catch (e: any) {
      await tx.rollback();
      throw new Error(`Failed to create instruction: ${e}`);
    }
  }

  public async updateInstruction(
    input: UpdateInstructionInput,
  ): Promise<Instruction> {
    const tx = await this.instructionRepository.transaction();
    try {
      this.validateInstructionInput(input);
      const instruction = await this.instructionRepository.findOneBy(
        { id: input.id, projectId: input.projectId },
        {
          tx,
        },
      );
      if (!instruction) {
        throw new Error('Instruction not found');
      }
      const instructionData = merge(instruction, input);
      const updatedInstruction = await this.instructionRepository.updateOne(
        input.id,
        instructionData,
        { tx },
      );
      const { queryId } = await this.wrenAIAdaptor.generateInstruction([
        this.pickGenerateInstructionInput(updatedInstruction),
      ]);
      const res = await this.waitDeployInstruction(`${queryId}1`);
      if (res.error) {
        await tx.rollback();
        throw Errors.create(res.error.code, {
          customMessage: res.error.message,
        });
      }
      await tx.commit();
      return updatedInstruction;
    } catch (e: any) {
      await tx.rollback();
      throw new Error(`Failed to update instruction: ${e}`);
    }
  }
  async deleteInstruction(id: number): Promise<void> {
    const tx = await this.instructionRepository.transaction();
    try {
      const instruction = await this.instructionRepository.findOneBy(
        { id },
        { tx },
      );
      if (!instruction) {
        throw new Error('Instruction not found');
      }
      await this.instructionRepository.deleteOne(id, { tx });
      await this.wrenAIAdaptor.deleteInstructions([id], instruction.projectId);
      await tx.commit();
    } catch (e: any) {
      await tx.rollback();
      throw new Error(`Failed to delete instruction: ${e}`);
    }
  }

  private async waitDeployInstruction(
    queryId: string,
  ): Promise<InstructionResult> {
    const isFinalStatus = (status: InstructionStatus) =>
      status === InstructionStatus.FINISHED ||
      status === InstructionStatus.FAILED;
    let res = await this.wrenAIAdaptor.getInstructionResult(queryId);
    while (!isFinalStatus(res.status)) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      res = await this.wrenAIAdaptor.getInstructionResult(queryId);
    }
    return res;
  }

  private pickGenerateInstructionInput(
    instruction: Instruction,
  ): GenerateInstructionInput {
    return pick(instruction, [
      'id',
      'projectId',
      'instruction',
      'questions',
      'isDefault',
    ]);
  }

  private validateInstructionInput(input: InstructionInput): void {
    if (!input.instruction) {
      throw new Error('Instruction is required');
    }
    if (input.instruction.length > 1000) {
      throw new Error('Instruction is too long');
    }
  }
}
