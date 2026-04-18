import {
  hasCanonicalRuntimeIdentity,
  isPersistedRuntimeIdentityMatch,
  normalizeCanonicalPersistedRuntimeIdentity,
  requireRuntimeScope,
  resolveCanonicalRuntimeScopeIdFromPersistedIdentity,
  resolvePersistedProjectBridgeId,
  resolveRuntimeScopeIdFromPersistedIdentityWithProjectBridgeFallback,
  toCanonicalPersistedRuntimeIdentityFromScope,
  toProjectBridgeRuntimeIdentity,
  toPersistedRuntimeIdentityPatch,
  toPersistedRuntimeIdentityFromSource,
} from '../persistedRuntimeIdentity';
import { toPersistedRuntimeIdentity } from '../../context/runtimeScope';

describe('persistedRuntimeIdentity', () => {
  it('allows canonical runtime scope identities without a legacy project bridge', () => {
    expect(
      toPersistedRuntimeIdentityFromSource({
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      }),
    ).toEqual({
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: null,
    });
  });

  it('still rejects empty runtime identities', () => {
    expect(() => toPersistedRuntimeIdentityFromSource({})).toThrow(
      'Persisted runtime identity requires projectId',
    );
  });

  it('matches runtime identities when legacy project bridge is absent but canonical fields align', () => {
    expect(
      isPersistedRuntimeIdentityMatch(
        {
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
        },
        {
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: null,
        },
      ),
    ).toBe(true);
  });

  it('detects canonical runtime identity when any canonical scope field exists', () => {
    expect(
      hasCanonicalRuntimeIdentity({
        projectId: 42,
        knowledgeBaseId: 'kb-1',
      }),
    ).toBe(true);
    expect(hasCanonicalRuntimeIdentity({ projectId: 42 })).toBe(false);
  });

  it('drops project bridge when canonical runtime identity is normalized', () => {
    expect(
      normalizeCanonicalPersistedRuntimeIdentity({
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: null,
        kbSnapshotId: null,
        deployHash: null,
        actorUserId: 'user-1',
      }),
    ).toEqual({
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: null,
      kbSnapshotId: null,
      deployHash: null,
      actorUserId: 'user-1',
    });
  });

  it('builds a legacy-only runtime identity from a project bridge', () => {
    expect(toProjectBridgeRuntimeIdentity(42)).toEqual({
      projectId: 42,
      workspaceId: null,
      knowledgeBaseId: null,
      kbSnapshotId: null,
      deployHash: null,
      actorUserId: null,
    });
  });

  it('resolves canonical runtime scope ids without implicitly falling back to the legacy bridge', () => {
    expect(
      resolveCanonicalRuntimeScopeIdFromPersistedIdentity({
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      }),
    ).toBe('deploy-1');
    expect(
      resolveCanonicalRuntimeScopeIdFromPersistedIdentity({
        projectId: 42,
        workspaceId: null,
        knowledgeBaseId: null,
        kbSnapshotId: null,
        deployHash: null,
      }),
    ).toBeNull();
  });

  it('uses an explicit helper when runtime scope resolution should fall back to the project bridge', () => {
    expect(
      resolveRuntimeScopeIdFromPersistedIdentityWithProjectBridgeFallback({
        projectId: 42,
        workspaceId: null,
        knowledgeBaseId: null,
        kbSnapshotId: null,
        deployHash: null,
      }),
    ).toBe('42');
    expect(
      resolveRuntimeScopeIdFromPersistedIdentityWithProjectBridgeFallback(
        {
          projectId: null,
          workspaceId: null,
          knowledgeBaseId: null,
          kbSnapshotId: null,
          deployHash: null,
        },
        99,
      ),
    ).toBe('99');
  });

  it('resolves persisted project bridge ids with optional fallback', () => {
    expect(
      resolvePersistedProjectBridgeId({
        projectId: 42,
      }),
    ).toBe(42);
    expect(
      resolvePersistedProjectBridgeId(
        {
          projectId: null,
        },
        99,
      ),
    ).toBe(99);
    expect(resolvePersistedProjectBridgeId(null)).toBeNull();
  });

  it('builds a canonical persistence patch that nulls the legacy project bridge', () => {
    expect(
      toPersistedRuntimeIdentityPatch({
        projectId: 42,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
      }),
    ).toEqual({
      projectId: null,
      workspaceId: 'workspace-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snapshot-1',
      deployHash: 'deploy-1',
      actorUserId: 'user-1',
    });
  });

  it('builds an all-null persistence patch when runtime identity is absent', () => {
    expect(toPersistedRuntimeIdentityPatch()).toEqual({
      projectId: null,
      workspaceId: null,
      knowledgeBaseId: null,
      kbSnapshotId: null,
      deployHash: null,
      actorUserId: null,
    });
  });

  it('throws a clear error when canonical identity is requested without runtime scope', () => {
    expect(() => toCanonicalPersistedRuntimeIdentityFromScope(null)).toThrow(
      'Runtime scope is required for this operation',
    );
    expect(() => toPersistedRuntimeIdentity(null)).toThrow(
      'Runtime scope is required for this operation',
    );
    expect(() => requireRuntimeScope(null)).toThrow(
      'Runtime scope is required for this operation',
    );
  });
});
