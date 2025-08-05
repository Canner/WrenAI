import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
  respondWithSimple,
  handleApiError,
} from '@/apollo/server/utils/apiUtils';
import { getLogger } from '@server/utils';
import { isNil } from 'lodash';

const logger = getLogger('API_INSTRUCTIONS');
logger.level = 'debug';

const { projectService, instructionService } = components;

/**
 * Instructions API - Supports two types of instructions:
 *
 * 1. Global Instructions (isGlobal: true)
 *    - Apply to every query that Wren AI generates
 *    - Ideal for setting consistent standards, enforcing business rules
 *    - Should NOT include questions field
 *
 * 2. Question-Matching Instructions (isGlobal: false or undefined)
 *    - Applied only when user's question matches certain patterns
 *    - Ideal for guiding how Wren AI handles specific business concepts
 *    - MUST include questions array with at least one question
 */
interface CreateInstructionRequest {
  instruction: string;
  questions?: string[];
  isGlobal?: boolean;
}

/**
 * Handle GET request - list all instructions for the current project
 */
const handleGetInstructions = async (
  req: NextApiRequest,
  res: NextApiResponse,
  project: any,
  startTime: number,
) => {
  // Get all instructions for the current project
  const instructions = (
    (await instructionService.getInstructions(project.id)) || []
  ).map((instruction) => {
    const isGlobalValue =
      typeof instruction.isDefault === 'boolean'
        ? instruction.isDefault
        : Boolean(instruction.isDefault);
    return {
      id: instruction.id,
      instruction: instruction.instruction,
      questions: instruction.questions,
      isGlobal: isGlobalValue,
    };
  });

  // Return the instructions array directly
  await respondWithSimple({
    res,
    statusCode: 200,
    responsePayload: instructions,
    projectId: project.id,
    apiType: ApiType.GET_INSTRUCTIONS,
    startTime,
    requestPayload: {},
    headers: req.headers as Record<string, string>,
  });
};

/**
 * Handle POST request - create a new instruction
 */
const handleCreateInstruction = async (
  req: NextApiRequest,
  res: NextApiResponse,
  project: any,
  startTime: number,
) => {
  const { instruction, questions, isGlobal } =
    req.body as CreateInstructionRequest;

  // Input validation
  if (!instruction) {
    throw new ApiError('Instruction is required', 400);
  }

  if (instruction.length > 1000) {
    throw new ApiError('Instruction is too long (max 1000 characters)', 400);
  }

  if (isNil(isGlobal) && isNil(questions)) {
    throw new ApiError('isGlobal or questions is required', 400);
  }

  // Validate instruction type and fields
  if (isGlobal === true) {
    // Global instruction - questions should not be provided
    if (questions && questions.length > 0) {
      throw new ApiError(
        'Global instructions should not include questions. Questions are only for question-matching instructions.',
        400,
      );
    }
  } else {
    // Question-matching instruction - questions are required
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      throw new ApiError(
        'Question-matching instructions require at least one question',
        400,
      );
    }

    // Validate each question
    questions.forEach((question, index) => {
      if (
        !question ||
        typeof question !== 'string' ||
        question.trim().length === 0
      ) {
        throw new ApiError(
          `Question at index ${index} is required and cannot be empty`,
          400,
        );
      }
      if (question.length > 500) {
        throw new ApiError(
          `Question at index ${index} is too long (max 500 characters)`,
          400,
        );
      }
    });
  }

  // Create the instruction
  const newInstruction = await instructionService.createInstruction({
    instruction,
    questions: questions || [],
    isDefault: isGlobal === true,
    projectId: project.id,
  });

  // Return the created instruction directly
  const isGlobalValue =
    typeof newInstruction.isDefault === 'boolean'
      ? newInstruction.isDefault
      : Boolean(newInstruction.isDefault);
  await respondWithSimple({
    res,
    statusCode: 201,
    responsePayload: {
      id: newInstruction.id,
      instruction: newInstruction.instruction,
      questions: newInstruction.questions,
      isGlobal: isGlobalValue,
    },
    projectId: project.id,
    apiType: ApiType.CREATE_INSTRUCTION,
    startTime,
    requestPayload: req.body,
    headers: req.headers as Record<string, string>,
  });
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const startTime = Date.now();
  let project;

  try {
    project = await projectService.getCurrentProject();

    // Handle GET method - list instructions
    if (req.method === 'GET') {
      await handleGetInstructions(req, res, project, startTime);
      return;
    }

    // Handle POST method - create instruction
    if (req.method === 'POST') {
      await handleCreateInstruction(req, res, project, startTime);
      return;
    }

    // Method not allowed
    throw new ApiError('Method not allowed', 405);
  } catch (error) {
    await handleApiError({
      error,
      res,
      projectId: project?.id,
      apiType:
        req.method === 'GET'
          ? ApiType.GET_INSTRUCTIONS
          : ApiType.CREATE_INSTRUCTION,
      requestPayload: req.method === 'GET' ? {} : req.body,
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
