import { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ApiType } from '@server/repositories/apiHistoryRepository';
import {
  ApiError,
  handleApiError,
  respondWithSimple,
} from '@/server/utils/apiUtils';
import { getLogger } from '@server/utils';
import {
  requirePersistedWorkspaceId,
  toCanonicalPersistedRuntimeIdentityFromScope,
} from '@server/utils/persistedRuntimeIdentity';
import { reencryptSecrets } from '@server/services/secretReencrypt';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  buildAuthorizationContextFromRequest,
  recordAuditEvent,
} from '@server/authz';

const logger = getLogger('API_SECRET_REENCRYPT');
logger.level = 'debug';

const { runtimeScopeResolver, secretRepository, secretService } = components;

interface SecretReencryptRequest {
  targetKeyVersion: number;
  sourceKeyVersion?: number;
  scopeType?: string;
  execute?: boolean;
}

const parsePositiveInteger = (value: unknown, field: string): number => {
  const parsed =
    typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ApiError(`${field} must be a positive integer`, 400);
  }

  return parsed;
};

const validatePayload = (payload: Partial<SecretReencryptRequest>) => {
  if (payload.targetKeyVersion === undefined) {
    throw new ApiError('targetKeyVersion is required', 400);
  }

  const targetKeyVersion = parsePositiveInteger(
    payload.targetKeyVersion,
    'targetKeyVersion',
  );

  const sourceKeyVersion =
    payload.sourceKeyVersion === undefined
      ? undefined
      : parsePositiveInteger(payload.sourceKeyVersion, 'sourceKeyVersion');

  if (
    payload.scopeType !== undefined &&
    (typeof payload.scopeType !== 'string' ||
      payload.scopeType.trim().length === 0)
  ) {
    throw new ApiError('scopeType must be a non-empty string', 400);
  }

  if (payload.execute !== undefined && typeof payload.execute !== 'boolean') {
    throw new ApiError('execute must be a boolean', 400);
  }

  return {
    targetKeyVersion,
    sourceKeyVersion,
    scopeType: payload.scopeType?.trim(),
    execute: payload.execute === true,
  };
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const startTime = Date.now();
  let runtimeScope;

  try {
    if (req.method !== 'POST') {
      throw new ApiError('Method not allowed', 405);
    }

    runtimeScope = await runtimeScopeResolver.resolveRequestScope(req);
    const runtimeIdentity =
      toCanonicalPersistedRuntimeIdentityFromScope(runtimeScope);
    const workspaceId = requirePersistedWorkspaceId(runtimeIdentity);
    const actor = buildAuthorizationActorFromRuntimeScope(runtimeScope);
    const auditContext = buildAuthorizationContextFromRequest({
      req,
      sessionId: actor?.sessionId,
      runtimeScope,
    });
    const payload = validatePayload((req.body || {}) as SecretReencryptRequest);
    await assertAuthorizedWithAudit({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'secret.reencrypt',
      resource: {
        resourceType: 'workspace',
        resourceId: workspaceId,
        workspaceId,
      },
      context: auditContext,
    });

    const summary = await reencryptSecrets(
      {
        secretRepository,
        sourceSecretService: secretService,
        targetSecretService: secretService,
      },
      {
        workspaceId,
        scopeType: payload.scopeType,
        sourceKeyVersion: payload.sourceKeyVersion,
        targetKeyVersion: payload.targetKeyVersion,
        execute: payload.execute,
      },
    );

    await recordAuditEvent({
      auditEventRepository: components.auditEventRepository,
      actor,
      action: 'secret.reencrypt',
      resource: {
        resourceType: 'workspace',
        resourceId: workspaceId,
        workspaceId,
      },
      result: 'succeeded',
      context: auditContext,
      payloadJson: summary as any,
    });

    await respondWithSimple({
      res,
      statusCode: 200,
      responsePayload: summary,
      runtimeScope,
      apiType: ApiType.REENCRYPT_SECRETS,
      startTime,
      requestPayload: req.body,
      headers: req.headers as Record<string, string>,
    });
  } catch (error) {
    await handleApiError({
      error,
      res,
      runtimeScope,
      apiType: ApiType.REENCRYPT_SECRETS,
      requestPayload: req.body ?? {},
      headers: req.headers as Record<string, string>,
      startTime,
      logger,
    });
  }
}
