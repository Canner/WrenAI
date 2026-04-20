import { NextApiRequest } from 'next';
import { RuntimeScopeSelector } from './runtimeScopeTypes';

const BODY_KEYS = {
  runtimeScopeId: ['runtimeScopeId', 'runtime_scope_id'],
  workspaceId: ['workspaceId', 'workspace_id'],
  knowledgeBaseId: ['knowledgeBaseId', 'knowledge_base_id'],
  kbSnapshotId: ['kbSnapshotId', 'kb_snapshot_id'],
  deployHash: ['deployHash', 'deploy_hash'],
} as const;

const HEADER_KEYS = {
  runtimeScopeId: ['x-wren-runtime-scope-id', 'x-runtime-scope-id'],
  workspaceId: ['x-wren-workspace-id', 'x-workspace-id'],
  knowledgeBaseId: ['x-wren-knowledge-base-id', 'x-knowledge-base-id'],
  kbSnapshotId: ['x-wren-kb-snapshot-id', 'x-kb-snapshot-id'],
  deployHash: ['x-wren-deploy-hash', 'x-deploy-hash'],
} as const;

const readValueFromObject = (
  source: Record<string, any> | undefined | null,
  keys: readonly string[],
): string | null => {
  if (!source) {
    return null;
  }

  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) {
      if (value[0]) {
        return String(value[0]);
      }
      continue;
    }
    if (value !== undefined && value !== null && `${value}`.trim() !== '') {
      return String(value);
    }
  }

  return null;
};

const readHeaderValue = (
  headers: NextApiRequest['headers'],
  keys: readonly string[],
): string | null => {
  for (const key of keys) {
    const value = headers[key];
    if (Array.isArray(value)) {
      if (value[0]) {
        return value[0];
      }
      continue;
    }
    if (value) {
      return value;
    }
  }

  return null;
};

export const coerceRuntimeScopeInteger = (
  value: string | null,
): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

export const hasModernRuntimeScopeSelector = (
  selector: RuntimeScopeSelector,
): boolean =>
  Boolean(
    selector.workspaceId ||
      selector.knowledgeBaseId ||
      selector.kbSnapshotId ||
      selector.deployHash,
  );

export const hasExplicitRuntimeScopeSelector = (
  selector: RuntimeScopeSelector,
): boolean =>
  Boolean(hasModernRuntimeScopeSelector(selector) || selector.bridgeProjectId);

export const readRuntimeScopeSelector = (
  req: NextApiRequest,
): RuntimeScopeSelector => {
  const body =
    req.body && typeof req.body === 'object'
      ? (req.body as Record<string, any>)
      : undefined;
  const bodyVariables =
    body?.variables && typeof body.variables === 'object'
      ? (body.variables as Record<string, any>)
      : undefined;
  const query = req.query as Record<string, any>;

  const selector = {
    runtimeScopeId:
      readValueFromObject(body, BODY_KEYS.runtimeScopeId) ||
      readValueFromObject(bodyVariables, BODY_KEYS.runtimeScopeId) ||
      readValueFromObject(query, BODY_KEYS.runtimeScopeId) ||
      readHeaderValue(req.headers, HEADER_KEYS.runtimeScopeId),
    workspaceId:
      readValueFromObject(body, BODY_KEYS.workspaceId) ||
      readValueFromObject(bodyVariables, BODY_KEYS.workspaceId) ||
      readValueFromObject(query, BODY_KEYS.workspaceId) ||
      readHeaderValue(req.headers, HEADER_KEYS.workspaceId),
    knowledgeBaseId:
      readValueFromObject(body, BODY_KEYS.knowledgeBaseId) ||
      readValueFromObject(bodyVariables, BODY_KEYS.knowledgeBaseId) ||
      readValueFromObject(query, BODY_KEYS.knowledgeBaseId) ||
      readHeaderValue(req.headers, HEADER_KEYS.knowledgeBaseId),
    kbSnapshotId:
      readValueFromObject(body, BODY_KEYS.kbSnapshotId) ||
      readValueFromObject(bodyVariables, BODY_KEYS.kbSnapshotId) ||
      readValueFromObject(query, BODY_KEYS.kbSnapshotId) ||
      readHeaderValue(req.headers, HEADER_KEYS.kbSnapshotId),
    deployHash:
      readValueFromObject(body, BODY_KEYS.deployHash) ||
      readValueFromObject(bodyVariables, BODY_KEYS.deployHash) ||
      readValueFromObject(query, BODY_KEYS.deployHash) ||
      readHeaderValue(req.headers, HEADER_KEYS.deployHash),
  };

  return {
    ...selector,
    bridgeProjectId: null,
  };
};
