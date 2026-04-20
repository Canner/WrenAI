import { NextApiRequest } from 'next';
import { Deploy, KBSnapshot, KnowledgeBase, Workspace } from '@server/repositories';
import { resolveRequestActor, type ResolvedRequestActor } from './actorClaims';
import {
  coerceRuntimeScopeInteger,
  hasExplicitRuntimeScopeSelector,
  hasModernRuntimeScopeSelector,
  readRuntimeScopeSelector,
} from './runtimeScopeRequestHelpers';
import {
  IRuntimeScopeResolver,
  RuntimeScope,
  RuntimeScopeResolutionError,
  RuntimeScopeResolverDependencies,
  RuntimeScopeSelector,
} from './runtimeScopeTypes';

export type {
  PersistedRuntimeIdentity,
  RuntimeScope,
  RuntimeScopeResolverDependencies,
  RuntimeScopeSelector,
  IRuntimeScopeResolver,
} from './runtimeScopeTypes';
export {
  RuntimeScopeResolutionError,
  toPersistedRuntimeIdentity,
} from './runtimeScopeTypes';

export class RuntimeScopeResolver implements IRuntimeScopeResolver {
  private projectRepository: RuntimeScopeResolverDependencies['projectRepository'];
  private deployService: RuntimeScopeResolverDependencies['deployService'];
  private authService: RuntimeScopeResolverDependencies['authService'];
  private workspaceRepository: RuntimeScopeResolverDependencies['workspaceRepository'];
  private knowledgeBaseRepository: RuntimeScopeResolverDependencies['knowledgeBaseRepository'];
  private kbSnapshotRepository: RuntimeScopeResolverDependencies['kbSnapshotRepository'];

  constructor({
    projectRepository,
    deployService,
    authService,
    workspaceRepository,
    knowledgeBaseRepository,
    kbSnapshotRepository,
  }: RuntimeScopeResolverDependencies) {
    this.projectRepository = projectRepository;
    this.deployService = deployService;
    this.authService = authService;
    this.workspaceRepository = workspaceRepository;
    this.knowledgeBaseRepository = knowledgeBaseRepository;
    this.kbSnapshotRepository = kbSnapshotRepository;
  }

  public async resolveRequestScope(req: NextApiRequest): Promise<RuntimeScope> {
    const selector = readRuntimeScopeSelector(req);
    const actor = await resolveRequestActor({
      req,
      authService: this.authService,
      workspaceId: selector.workspaceId,
    });

    if (hasExplicitRuntimeScopeSelector(selector)) {
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
        requestActor: actor,
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
    const bridgeProjectId = coerceRuntimeScopeInteger(normalizedScopeId);
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

    const resolvedDeployHash = kbSnapshot?.deployHash || selector.deployHash || null;
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
    if (
      !deployment &&
      selector.deployHash &&
      !shouldDowngradeToDraftCanonicalScope
    ) {
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
      requestActor: actor,
    };
  }

  private async resolveProjectForScope(
    selector: RuntimeScopeSelector,
    deployment: Deploy | null,
  ) {
    const bridgeProjectId = selector.bridgeProjectId || null;

    if (deployment) {
      if (!hasModernRuntimeScopeSelector(selector)) {
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
  ) {
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
      bridgeProjectId: hasModernRuntimeScopeSelector(selector)
        ? null
        : selector.bridgeProjectId || null,
    };
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
    if (!hasModernRuntimeScopeSelector(selector)) {
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
    const shouldUseProjectBridgeFallback =
      !hasModernRuntimeScopeSelector(selector);

    return {
      workspaceId: selector.workspaceId || null,
      knowledgeBaseId:
        selector.knowledgeBaseId || kbSnapshot?.knowledgeBaseId || null,
      kbSnapshotId: selector.kbSnapshotId || kbSnapshot?.id || null,
      projectId: shouldUseProjectBridgeFallback
        ? selector.bridgeProjectId || null
        : null,
      deployHash,
    };
  }
}
