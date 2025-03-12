import { IContext } from '@server/types';
import { UpdateInstructionInput } from '@server/models';
import { Instruction } from '@server/repositories/instructionRepository';
import { getLogger } from '@server/utils';

const logger = getLogger('InstructionResolver');
logger.level = 'debug';

export class InstructionResolver {
  constructor() {
    this.getInstructions = this.getInstructions.bind(this);
    this.createInstruction = this.createInstruction.bind(this);
    this.updateInstruction = this.updateInstruction.bind(this);
    this.deleteInstruction = this.deleteInstruction.bind(this);
  }

  public async getInstructions(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<Instruction[]> {
    try {
      const project = await ctx.projectService.getCurrentProject();
      return await ctx.instructionService.getInstructions(project.id);
    } catch (error) {
      logger.error(`Error getting instructions: ${error}`);
      throw error;
    }
  }

  public async createInstruction(
    _root: any,
    args: {
      data: {
        instruction: string;
        questions: string[];
        isDefault: boolean;
      };
    },
    ctx: IContext,
  ): Promise<Instruction> {
    const { instruction, questions, isDefault } = args.data;
    const project = await ctx.projectService.getCurrentProject();
    return await ctx.instructionService.createInstruction({
      instruction,
      questions,
      isDefault,
      projectId: project.id,
    });
  }

  public async updateInstruction(
    _root: any,
    args: {
      data: Pick<
        UpdateInstructionInput,
        'instruction' | 'questions' | 'isDefault'
      >;
      where: { id: number };
    },
    ctx: IContext,
  ): Promise<Instruction> {
    const { id } = args.where;
    const { instruction, questions, isDefault } = args.data;
    if (!id) {
      throw new Error('Instruction ID is required.');
    }
    const project = await ctx.projectService.getCurrentProject();
    return await ctx.instructionService.updateInstruction({
      id,
      projectId: project.id,
      instruction,
      questions,
      isDefault,
    });
  }

  public async deleteInstruction(
    _root: any,
    args: { where: { id: number } },
    ctx: IContext,
  ): Promise<boolean> {
    const { id } = args.where;
    await ctx.instructionService.deleteInstruction(id);
    return true;
  }
}
