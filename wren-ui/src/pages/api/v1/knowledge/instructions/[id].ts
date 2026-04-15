import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
  respondWithSimple,
  handleApiError,
} from '@/apollo/server/utils/apiUtils';
import { getLogger } from '@server/utils';
import * as Errors from '@server/utils/error';
import {
  resolvePersistedKnowledgeBaseId,
  requirePersistedWorkspaceId,
  toCanonicalPersistedRuntimeIdentityFromScope,
} from '@server/utils/persistedRuntimeIdentity';
import {
  OUTDATED_RUNTIME_SNAPSHOT_MESSAGE,
  assertLatestExecutableRuntimeScope,
} from '@/apollo/server/utils/runtimeExecutionContext';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  buildAuthorizationContextFromRequest,
  recordAuditEvent,
} from '@server/authz';

const logger = getLogger('API_INSTRUCTION_BY_ID');
logger.level = 'debug';

const {
  runtimeScopeResolver,
  instructionService,
  knowledgeBaseRepository,
  kbSnapshotRepository,
} = components;

const assertLatestInstructionSnapshot = async (runtimeScope: any) => {
  try {
    await assertLatestExecutableRuntimeScope({
      runtimeScope,
      knowledgeBaseRepository,
      kbSnapshotRepository,
    });
  } catch (error) {
    throw new ApiError(
      error instanceof Error
        ? error.message
        : OUTDATED_RUNTIME_SNAPSHOT_MESSAGE,
      409,
      Errors.GeneralErrorCodes.OUTDATED_RUNTIME_SNAPSHOT,
    );
  }
};

const buildKnowledgeBaseReadResource = (runtimeIdentity: any) => ({
  resourceType: 'knowledge_base' as const,
  resourceId: resolvePersistedKnowledgeBaseId(
    runtimeIdentity,
    undefined,
    'Knowledge base scope is required',
  ),
  workspaceId: requirePersistedWorkspaceId(runtimeIdentity),
});

const buildKnowledgeBaseWriteResource = (
  runtimeScope: any,
  runtimeIdentity: any,
) => ({
  ...buildKnowledgeBaseReadResource(runtimeIdentity),
  attributes: {
    workspaceKind: runtimeScope?.workspace?.kind || null,
    knowledgeBaseKind: runtimeScope?.knowledgeBase?.kind || null,
  },
});

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
interface UpdateInstructionRequest {
  instruction?: string;
  questions?: string[];
  isGlobal?: boolean;
}

/**
 * Validate instruction ID from request query
 */
const validateInstructionId = (id: any): number => {
  if (!id || typeof id !== 'string') {
    throw new ApiError('Instruction ID is required', 400);
  }

  const instructionId = parseInt(id, 10);
  if (isNaN(instructionId)) {
    throw new ApiError('Invalid instruction ID', 400);
  }

  return instructionId;
};

/**
 * Handle PUT request - update an existing instruction
 */
const handleUpdateInstruction = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  startTime: number,
) => {
  await assertLatestInstructionSnapshot(runtimeScope);
  const { id } = req.query;
  const instructionId = validateInstructionId(id);
  const runtimeIdentity =
    toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
  const actor = buildAuthorizationActorFromRuntimeScope(runtimeScope);
  const auditContext = buildAuthorizationContextFromRequest({
    req,
    sessionId: actor?.sessionId,
    runtimeScope,
  });
  const resource = buildKnowledgeBaseWriteResource(
    runtimeScope,
    runtimeIdentity,
  );
  await assertAuthorizedWithAudit({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'knowledge_base.update',
    resource,
    context: auditContext,
  });

  const { instruction, questions, isGlobal } =
    req.body as UpdateInstructionRequest;

  // Get the original instruction
  const existingInstruction = await instructionService.getInstruction(
    runtimeIdentity,
    instructionId,
  );

  if (!existingInstruction) {
    throw new ApiError('Instruction not found', 404);
  }

  // Merge original with update payload
  const mergedInstruction = {
    instruction: instruction ?? existingInstruction.instruction,
    questions: questions ?? existingInstruction.questions,
    isGlobal: isGlobal ?? existingInstruction.isDefault,
  };

  // If isGlobal is true, set questions to empty array
  if (mergedInstruction.isGlobal === true) {
    mergedInstruction.questions = [];
  }

  // Update the instruction
  const updatedInstruction = await instructionService.updateInstruction(
    runtimeIdentity,
    {
      id: instructionId,
      instruction: mergedInstruction.instruction,
      questions: mergedInstruction.questions,
      isDefault: mergedInstruction.isGlobal,
    },
  );

  await recordAuditEvent({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'knowledge_base.update',
    resource,
    result: 'succeeded',
    context: auditContext,
    beforeJson: existingInstruction as any,
    afterJson: updatedInstruction as any,
    payloadJson: {
      operation: 'instruction.update',
      instructionId,
    },
  });

  // Return the updated instruction directly
  const isGlobalValue =
    typeof updatedInstruction.isDefault === 'boolean'
      ? updatedInstruction.isDefault
      : Boolean(updatedInstruction.isDefault);
  await respondWithSimple({
    res,
    statusCode: 200,
    responsePayload: {
      id: updatedInstruction.id,
      instruction: updatedInstruction.instruction,
      questions: updatedInstruction.questions,
      isGlobal: isGlobalValue,
      createdAt: updatedInstruction.createdAt ?? null,
      updatedAt: updatedInstruction.updatedAt ?? null,
    },
    runtimeScope,
    apiType: ApiType.UPDATE_INSTRUCTION,
    startTime,
    requestPayload: req.body,
    headers: req.headers as Record<string, string>,
  });
};

/**
 * Handle DELETE request - delete an instruction
 */
const handleDeleteInstruction = async (
  req: NextApiRequest,
  res: NextApiResponse,
  runtimeScope: any,
  startTime: number,
) => {
  await assertLatestInstructionSnapshot(runtimeScope);
  const { id } = req.query;
  const instructionId = validateInstructionId(id);
  const runtimeIdentity =
    toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
  const actor = buildAuthorizationActorFromRuntimeScope(runtimeScope);
  const auditContext = buildAuthorizationContextFromRequest({
    req,
    sessionId: actor?.sessionId,
    runtimeScope,
  });
  const resource = buildKnowledgeBaseWriteResource(
    runtimeScope,
    runtimeIdentity,
  );
  await assertAuthorizedWithAudit({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'knowledge_base.update',
    resource,
    context: auditContext,
  });
  const existingInstruction = await instructionService.getInstruction(
    runtimeIdentity,
    instructionId,
  );
  if (!existingInstruction) {
    throw new ApiError('Instruction not found', 404);
  }

  // Delete the instruction
  await instructionService.deleteInstruction(instructionId, runtimeIdentity);

  await recordAuditEvent({
    auditEventRepository: components.auditEventRepository,
    actor,
    action: 'knowledge_base.update',
    resource,
    result: 'succeeded',
    context: auditContext,
    beforeJson: existingInstruction as any,
    payloadJson: {
      operation: 'instruction.delete',
      instructionId,
    },
  });

  // Return 204 No Content with no payload
  await respondWithSimple({
    res,
    statusCode: 204,
    responsePayload: {},
    runtimeScope,
    apiType: ApiType.DELETE_INSTRUCTION,
    startTime,
    requestPayload: { id: instructionId },
    headers: req.headers as Record<string, string>,
  });
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const startTime = Date.now();
  let runtimeScope;

  try {
    runtimeScope = await runtimeScopeResolver.resolveRequestScope(req);
    const runtimeIdentity =
      toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
    const actor = buildAuthorizationActorFromRuntimeScope(runtimeScope);
    const auditContext = buildAuthorizationContextFromRequest({
      req,
      sessionId: actor?.sessionId,
      runtimeScope,
    });

    // Handle PUT method - update instruction
    if (req.method === 'PUT') {
      await handleUpdateInstruction(req, res, runtimeScope, startTime);
      return;
    }

    // Handle DELETE method - delete instruction
    if (req.method === 'DELETE') {
      await assertAuthorizedWithAudit({
        auditEventRepository: components.auditEventRepository,
        actor,
        action: 'knowledge_base.read',
        resource: buildKnowledgeBaseReadResource(runtimeIdentity),
        context: auditContext,
      });
      await handleDeleteInstruction(req, res, runtimeScope, startTime);
      return;
    }

    // Method not allowed
    throw new ApiError('Method not allowed', 405);
  } catch (error) {
    await handleApiError({
      error,
      res,
      runtimeScope,
      apiType:
        req.method === 'PUT'
          ? ApiType.UPDATE_INSTRUCTION
          : ApiType.DELETE_INSTRUCTION,
      requestPayload: req.method === 'PUT' ? req.body : { id: req.query.id },
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
