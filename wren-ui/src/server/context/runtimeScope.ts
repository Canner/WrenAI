import { NextApiRequest } from 'next';
import {
  Deploy,
  IKnowledgeBaseRepository,
  IKBSnapshotRepository,
  IProjectRepository,
  IWorkspaceRepository,
  KBSnapshot,
  KnowledgeBase,
  Project,
  Workspace,
} from '@server/repositories';
import { ActorClaims, IAuthService } from '@server/services/authService';
import { IDeployService } from '@server/services/deployService';
import { toPersistedRuntimeIdentityFromSource } from '@server/utils/persistedRuntimeIdentity';
import { ResolvedRequestActor, resolveRequestActor } from './actorClaims';

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

const coerceInteger = (value: string | null): number | null => {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

export interface RuntimeScopeSelector {
  runtimeScopeId?: string | null;
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
  bridgeProjectId?: number | null;
}

export interface RuntimeScope {
  source: 'explicit-request' | 'compatibility-runtime-shim';
  selector: RuntimeScopeSelector;
  project: Project | null;
  deployment: Deploy | null;
  deployHash: string | null;
  workspace: Workspace | null;
  knowledgeBase: KnowledgeBase | null;
  kbSnapshot: KBSnapshot | null;
  actorClaims: ActorClaims | null;
  userId: string | null;
}

export interface PersistedRuntimeIdentity {
  projectId?: number | null;
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  kbSnapshotId?: string | null;
  deployHash?: string | null;
  actorUserId?: string | null;
}

class RuntimeScopeResolutionError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'RuntimeScopeResolutionError';
    this.statusCode = statusCode;
  }
}

export const toPersistedRuntimeIdentity = (
  runtimeScope?: RuntimeScope | null,
): PersistedRuntimeIdentity => {
  if (!runtimeScope) {
    throw new Error('Runtime scope is required for this operation');
  }

  return toPersistedRuntimeIdentityFromSource({
    projectId:
      runtimeScope.deployment?.projectId ?? runtimeScope.project?.id ?? null,
    workspaceId: runtimeScope.workspace?.id || null,
    knowledgeBaseId: runtimeScope.knowledgeBase?.id || null,
    kbSnapshotId: runtimeScope.kbSnapshot?.id || null,
    deployHash: runtimeScope.deployHash || null,
    actorUserId: runtimeScope.userId || null,
  });
};

export interface IRuntimeScopeResolver {
  resolveRequestScope(req: NextApiRequest): Promise<RuntimeScope>;
  resolveRuntimeScopeId(runtimeScopeId: string): Promise<RuntimeScope>;
}

export class RuntimeScopeResolver implements IRuntimeScopeResolver {
  private projectRepository: IProjectRepository;
  private deployService: IDeployService;
  private authService: IAuthService;
  private workspaceRepository: IWorkspaceRepository;
  private knowledgeBaseRepository: IKnowledgeBaseRepository;
  private kbSnapshotRepository: IKBSnapshotRepository;

  constructor({
    projectRepository,
    deployService,
    authService,
    workspaceRepository,
    knowledgeBaseRepository,
    kbSnapshotRepository,
  }: {
    projectRepository: IProjectRepository;
    deployService: IDeployService;
    authService: IAuthService;
    workspaceRepository: IWorkspaceRepository;
    knowledgeBaseRepository: IKnowledgeBaseRepository;
    kbSnapshotRepository: IKBSnapshotRepository;
  }) {
    this.projectRepository = projectRepository;
    this.deployService = deployService;
    this.authService = authService;
    this.workspaceRepository = workspaceRepository;
    this.knowledgeBaseRepository = knowledgeBaseRepository;
    this.kbSnapshotRepository = kbSnapshotRepository;
  }

  public async resolveRequestScope(req: NextApiRequest): Promise<RuntimeScope> {
    const selector = this.readSelector(req);
    const actor = await resolveRequestActor({
      req,
      authService: this.authService,
      workspaceId: selector.workspaceId,
    });

    if (this.hasExplicitSelector(selector)) {
      return await this.resolveExplicitScope(selector, actor);
    }

    if (selector.runtimeScopeId) {
      const runtimeScope = await this.resolveRuntimeScopeId(
        selector.runtimeScopeId,
      );

      if (
        actor.actorClaims &&
        runtimeScope.workspace &&
        actor.actorClaims.workspaceId !== runtimeScope.workspace.id
      ) {
        throw new Error('Session workspace does not match requested workspace');
      }

      return {
        ...runtimeScope,
        actorClaims: actor.actorClaims,
        userId: actor.userId,
      };
    }

    throw new RuntimeScopeResolutionError(
      'Runtime scope selector is required for this request',
    );
  }

  public async resolveRuntimeScopeId(
    runtimeScopeId: string,
  ): Promise<RuntimeScope> {
    const normalizedScopeId = runtimeScopeId.trim();
    if (!normalizedScopeId) {
      throw new RuntimeScopeResolutionError('Runtime scope id is required');
    }

    const actor: ResolvedRequestActor = {
      sessionToken: null,
      actorClaims: null,
      userId: null,
      workspaceId: null,
      isPlatformAdmin: false,
      authorizationActor: null,
      sessionId: null,
    };

    const selectorCandidates: RuntimeScopeSelector[] = [
      { deployHash: normalizedScopeId },
      { kbSnapshotId: normalizedScopeId },
      { knowledgeBaseId: normalizedScopeId },
      { workspaceId: normalizedScopeId },
    ];
    const bridgeProjectId = coerceInteger(normalizedScopeId);
    if (bridgeProjectId) {
      selectorCandidates.push({ bridgeProjectId });
    }

    let lastError: unknown = null;
    for (const selector of selectorCandidates) {
      try {
        const runtimeScope = await this.resolveExplicitScope(selector, actor);
        return {
          ...runtimeScope,
          selector: {
            ...runtimeScope.selector,
            runtimeScopeId: normalizedScopeId,
          },
        };
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }

    throw new RuntimeScopeResolutionError(
      'Runtime scope id could not be resolved',
    );
  }

  private readSelector(req: NextApiRequest): RuntimeScopeSelector {
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
  }

  private hasExplicitSelector(selector: RuntimeScopeSelector): boolean {
    return Boolean(
      this.hasModernSelector(selector) || selector.bridgeProjectId,
    );
  }

  private hasModernSelector(selector: RuntimeScopeSelector): boolean {
    return Boolean(
      selector.workspaceId ||
        selector.knowledgeBaseId ||
        selector.kbSnapshotId ||
        selector.deployHash,
    );
  }

  private async resolveExplicitScope(
    selector: RuntimeScopeSelector,
    actor: ResolvedRequestActor,
  ): Promise<RuntimeScope> {
    let kbSnapshot = selector.kbSnapshotId
      ? await this.kbSnapshotRepository.findOneBy({ id: selector.kbSnapshotId })
      : null;

    if (!kbSnapshot && selector.knowledgeBaseId && selector.deployHash) {
      kbSnapshot = await this.kbSnapshotRepository.findOneBy({
        knowledgeBaseId: selector.knowledgeBaseId,
        deployHash: selector.deployHash,
      });
    }

    let knowledgeBase = kbSnapshot
      ? await this.knowledgeBaseRepository.findOneBy({
          id: kbSnapshot.knowledgeBaseId,
        })
      : null;

    if (!knowledgeBase && selector.knowledgeBaseId) {
      knowledgeBase = await this.knowledgeBaseRepository.findOneBy({
        id: selector.knowledgeBaseId,
      });
    }

    if (
      knowledgeBase?.defaultKbSnapshotId &&
      !kbSnapshot &&
      knowledgeBase.id === selector.knowledgeBaseId
    ) {
      kbSnapshot = await this.kbSnapshotRepository.findOneBy({
        id: knowledgeBase.defaultKbSnapshotId,
      });
    }

    if (
      selector.knowledgeBaseId &&
      kbSnapshot &&
      kbSnapshot.knowledgeBaseId !== selector.knowledgeBaseId
    ) {
      throw new Error(
        'kb_snapshot does not belong to the requested knowledge base',
      );
    }

    if (
      kbSnapshot &&
      selector.deployHash &&
      kbSnapshot.deployHash !== selector.deployHash
    ) {
      throw new Error('deploy_hash does not match the requested kb_snapshot');
    }

    const workspaceId =
      selector.workspaceId || knowledgeBase?.workspaceId || null;

    const workspace = workspaceId
      ? await this.workspaceRepository.findOneBy({ id: workspaceId })
      : null;

    if (
      !workspace &&
      (selector.workspaceId ||
        selector.knowledgeBaseId ||
        selector.kbSnapshotId)
    ) {
      throw new Error('Workspace scope could not be resolved');
    }

    if (
      knowledgeBase &&
      workspace &&
      knowledgeBase.workspaceId !== workspace.id
    ) {
      throw new Error(
        'Knowledge base does not belong to the requested workspace',
      );
    }

    if (
      actor.actorClaims &&
      workspace &&
      actor.actorClaims.workspaceId !== workspace.id
    ) {
      throw new Error('Session workspace does not match requested workspace');
    }

    const resolvedDeployHash =
      selector.deployHash || kbSnapshot?.deployHash || null;
    const shouldResolveDeployment = Boolean(
      resolvedDeployHash ||
        selector.kbSnapshotId ||
        selector.knowledgeBaseId ||
        selector.bridgeProjectId,
    );
    const deployment = shouldResolveDeployment
      ? await this.resolveDeploymentForScope(
          selector,
          kbSnapshot,
          resolvedDeployHash,
        )
      : null;
    const shouldDowngradeToDraftCanonicalScope =
      !deployment &&
      this.shouldDowngradeToDraftCanonicalScope({
        selector,
        workspace,
        knowledgeBase,
        kbSnapshot,
      });
    if (!deployment && selector.deployHash && !shouldDowngradeToDraftCanonicalScope) {
      throw new Error('No deployment found for the requested runtime scope');
    }
    const resolvedKbSnapshot = shouldDowngradeToDraftCanonicalScope
      ? null
      : kbSnapshot;
    const finalDeployHash = shouldDowngradeToDraftCanonicalScope
      ? null
      : deployment?.hash || resolvedDeployHash || null;
    const project = shouldDowngradeToDraftCanonicalScope
      ? null
      : await this.resolveProjectForScope(selector, deployment);

    return {
      source: 'explicit-request',
      selector: this.buildResolvedSelector({
        selector,
        workspaceId: workspace?.id || null,
        knowledgeBaseId: knowledgeBase?.id || null,
        kbSnapshotId: resolvedKbSnapshot?.id || null,
        deployHash: finalDeployHash,
      }),
      project,
      deployment,
      deployHash: finalDeployHash,
      workspace,
      knowledgeBase,
      kbSnapshot: resolvedKbSnapshot,
      actorClaims: actor.actorClaims,
      userId: actor.userId,
    };
  }

  private async resolveProjectForScope(
    selector: RuntimeScopeSelector,
    deployment: Deploy | null,
  ): Promise<Project | null> {
    const bridgeProjectId = this.resolveBridgeProjectId(selector);

    if (deployment) {
      if (!this.hasModernSelector(selector)) {
        return await this.projectRepository.findOneBy({
          id: deployment.projectId,
        });
      }

      return null;
    }

    if (bridgeProjectId) {
      return await this.projectRepository.findOneBy({ id: bridgeProjectId });
    }

    return null;
  }

  private async resolveDeploymentForScope(
    selector: RuntimeScopeSelector,
    kbSnapshot: KBSnapshot | null,
    deployHash?: string | null,
  ): Promise<Deploy | null> {
    return await this.deployService.getDeploymentByRuntimeIdentity(
      this.buildDeploymentLookupIdentity(selector, kbSnapshot, deployHash),
    );
  }

  private buildResolvedSelector({
    selector,
    workspaceId,
    knowledgeBaseId,
    kbSnapshotId,
    deployHash,
  }: {
    selector: RuntimeScopeSelector;
    workspaceId: string | null;
    knowledgeBaseId: string | null;
    kbSnapshotId: string | null;
    deployHash: string | null;
  }): RuntimeScopeSelector {
    return {
      runtimeScopeId: selector.runtimeScopeId || null,
      workspaceId,
      knowledgeBaseId,
      kbSnapshotId,
      deployHash,
      bridgeProjectId: this.hasModernSelector(selector)
        ? null
        : selector.bridgeProjectId || null,
    };
  }

  private resolveBridgeProjectId(
    selector: RuntimeScopeSelector,
  ): number | null {
    return selector.bridgeProjectId || null;
  }

  private shouldDowngradeToDraftCanonicalScope({
    selector,
    workspace,
    knowledgeBase,
    kbSnapshot,
  }: {
    selector: RuntimeScopeSelector;
    workspace: Workspace | null;
    knowledgeBase: KnowledgeBase | null;
    kbSnapshot: KBSnapshot | null;
  }) {
    if (!this.hasModernSelector(selector)) {
      return false;
    }

    if (!workspace && !knowledgeBase) {
      return false;
    }

    return Boolean(
      selector.deployHash || selector.kbSnapshotId || kbSnapshot?.deployHash,
    );
  }

  private buildDeploymentLookupIdentity(
    selector: RuntimeScopeSelector,
    kbSnapshot: KBSnapshot | null,
    deployHash?: string | null,
  ) {
    const shouldUseProjectBridgeFallback = !this.hasModernSelector(selector);

    return {
      workspaceId: selector.workspaceId || null,
      knowledgeBaseId:
        selector.knowledgeBaseId || kbSnapshot?.knowledgeBaseId || null,
      kbSnapshotId: selector.kbSnapshotId || kbSnapshot?.id || null,
      projectId: shouldUseProjectBridgeFallback
        ? this.resolveBridgeProjectId(selector)
        : null,
      deployHash,
    };
  }
}
