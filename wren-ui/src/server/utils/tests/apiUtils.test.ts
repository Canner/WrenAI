const mockCreateOne = jest.fn();
const mockGetProjectById = jest.fn();
const mockFindKnowledgeBaseBy = jest.fn();
const mockFindKbSnapshotBy = jest.fn();

jest.mock('@/common', () => ({
  components: {
    apiHistoryRepository: {
      createOne: mockCreateOne,
    },
    projectService: {
      getProjectById: mockGetProjectById,
    },
    knowledgeBaseRepository: {
      findOneBy: mockFindKnowledgeBaseBy,
    },
    kbSnapshotRepository: {
      findOneBy: mockFindKbSnapshotBy,
    },
  },
}));

import {
  buildAskDiagnostics,
  createApiHistoryRecord,
  deriveRuntimeExecutionContextFromRequest,
  getScopedThreadHistories,
  handleApiError,
  prepareSqlForDryRunValidation,
  validateSql,
} from '../apiUtils';
import { ApiType } from '../../repositories/apiHistoryRepository';

describe('apiUtils', () => {
  beforeEach(() => {
    mockCreateOne.mockReset();
    mockGetProjectById.mockReset();
    mockFindKnowledgeBaseBy.mockReset();
    mockFindKbSnapshotBy.mockReset();
  });

  describe('getScopedThreadHistories', () => {
    it('returns empty history when thread id is not provided', async () => {
      const findAllBy = jest.fn();

      const histories = await getScopedThreadHistories({
        apiHistoryRepository: { findAllBy } as any,
      });

      expect(histories).toEqual([]);
      expect(findAllBy).not.toHaveBeenCalled();
    });

    it('loads histories by threadId before runtime-identity filtering', async () => {
      const historyRows = [{ id: 'history-1' }];
      const findAllBy = jest.fn().mockResolvedValue(historyRows);

      const histories = await getScopedThreadHistories({
        apiHistoryRepository: { findAllBy } as any,
        threadId: 'thread-123',
      });

      expect(findAllBy).toHaveBeenCalledWith({
        threadId: 'thread-123',
      });
      expect(histories).toBe(historyRows);
    });

    it('filters histories by runtime identity to avoid cross-scope pollution', async () => {
      const historyRows = [
        {
          id: 'history-1',
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: null,
        },
        {
          id: 'history-2',
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
        },
        {
          id: 'history-3',
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-2',
          kbSnapshotId: 'snapshot-2',
          deployHash: 'deploy-2',
        },
      ];
      const findAllBy = jest.fn().mockResolvedValue(historyRows);

      const histories = await getScopedThreadHistories({
        apiHistoryRepository: { findAllBy } as any,
        threadId: 'thread-123',
        runtimeScope: {
          project: { id: 42 },
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1' },
          kbSnapshot: { id: 'snapshot-1' },
          deployHash: 'deploy-1',
        } as any,
      });

      expect(histories).toEqual([historyRows[0], historyRows[1]]);
    });

    it('still rejects histories when non-project runtime scope fields mismatch', async () => {
      const historyRows = [
        {
          id: 'history-1',
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-2',
          kbSnapshotId: 'snapshot-2',
          deployHash: 'deploy-2',
        },
      ];
      const findAllBy = jest.fn().mockResolvedValue(historyRows);

      const histories = await getScopedThreadHistories({
        apiHistoryRepository: { findAllBy } as any,
        threadId: 'thread-123',
        runtimeScope: {
          project: { id: 42 },
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1' },
          kbSnapshot: { id: 'snapshot-1' },
          deployHash: 'deploy-1',
        } as any,
      });

      expect(histories).toEqual([]);
    });
  });

  describe('createApiHistoryRecord', () => {
    it('persists canonical runtime identity without the legacy project bridge when scope ids are available', async () => {
      await createApiHistoryRecord({
        id: 'history-1',
        runtimeScope: {
          project: { id: 42 },
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1' },
          kbSnapshot: { id: 'snapshot-1' },
          deployHash: 'deploy-1',
          userId: 'user-1',
        } as any,
        apiType: ApiType.ASK,
        statusCode: 200,
      });

      expect(mockCreateOne).toHaveBeenCalledWith({
        id: 'history-1',
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
        apiType: ApiType.ASK,
        statusCode: 200,
      });
    });

    it('keeps the legacy project bridge for project-only runtime scopes', async () => {
      await createApiHistoryRecord({
        id: 'history-1a',
        runtimeScope: {
          project: { id: 42 },
          deployment: null,
          workspace: null,
          knowledgeBase: null,
          kbSnapshot: null,
          deployHash: null,
          userId: 'user-1',
        } as any,
        apiType: ApiType.RUN_SQL,
        statusCode: 200,
      });

      expect(mockCreateOne).toHaveBeenCalledWith({
        id: 'history-1a',
        projectId: 42,
        workspaceId: null,
        knowledgeBaseId: null,
        kbSnapshotId: null,
        deployHash: null,
        actorUserId: 'user-1',
        apiType: ApiType.RUN_SQL,
        statusCode: 200,
      });
    });

    it('persists deprojected runtime identities when legacy project bridge is absent', async () => {
      await createApiHistoryRecord({
        id: 'history-1b',
        runtimeScope: {
          project: null,
          deployment: null,
          workspace: { id: 'workspace-1' },
          knowledgeBase: { id: 'kb-1' },
          kbSnapshot: { id: 'snapshot-1' },
          deployHash: 'deploy-1',
          userId: 'user-1',
        } as any,
        apiType: ApiType.STREAM_ASK,
        threadId: 'thread-1',
        statusCode: 200,
      });

      expect(mockCreateOne).toHaveBeenCalledWith({
        id: 'history-1b',
        projectId: null,
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
        actorUserId: 'user-1',
        apiType: ApiType.STREAM_ASK,
        threadId: 'thread-1',
        statusCode: 200,
      });
    });

    it('skips persistence when runtime scope is unavailable', async () => {
      await expect(
        createApiHistoryRecord({
          id: 'history-2',
          apiType: ApiType.RUN_SQL,
          statusCode: 500,
        }),
      ).resolves.toBeNull();

      expect(mockCreateOne).not.toHaveBeenCalled();
    });
  });

  describe('handleApiError', () => {
    it('uses statusCode from non-ApiError errors when present', async () => {
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as any;

      await handleApiError({
        error: {
          message: 'Runtime scope selector is required for this request',
          statusCode: 400,
        },
        res,
        apiType: ApiType.ASK,
        startTime: Date.now(),
      });

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Runtime scope selector is required for this request',
        }),
      );
    });
  });

  describe('buildAskDiagnostics', () => {
    it('returns undefined when no diagnostics are available', () => {
      expect(buildAskDiagnostics(null)).toBeUndefined();
      expect(buildAskDiagnostics({} as any)).toBeUndefined();
    });

    it('returns ask trace, path and shadow compare when present', () => {
      expect(
        buildAskDiagnostics({
          traceId: 'trace-1',
          askPath: 'instructions',
          shadowCompare: {
            enabled: true,
            executed: true,
            matched: false,
            comparable: false,
            primaryType: 'TEXT_TO_SQL',
            shadowType: 'TEXT_TO_SQL',
          },
        } as any),
      ).toEqual({
        traceId: 'trace-1',
        askPath: 'instructions',
        shadowCompare: {
          enabled: true,
          executed: true,
          matched: false,
          comparable: false,
          primaryType: 'TEXT_TO_SQL',
          shadowType: 'TEXT_TO_SQL',
        },
      });
    });
  });

  describe('deriveRuntimeExecutionContextFromRequest', () => {
    it('resolves request scope and returns execution context plus runtime scope', async () => {
      const runtimeScope = {
        project: { id: 42, language: 'EN' },
        workspace: { id: 'workspace-1' },
        knowledgeBase: { id: 'kb-1' },
        kbSnapshot: { id: 'snapshot-1' },
        deployHash: 'deploy-1',
        deployment: {
          hash: 'deploy-1',
          manifest: { models: [] },
        },
        userId: 'user-1',
      } as any;

      const result = await deriveRuntimeExecutionContextFromRequest({
        req: { body: {} } as any,
        runtimeScopeResolver: {
          resolveRequestScope: jest.fn().mockResolvedValue(runtimeScope),
        },
      });

      expect(result.runtimeScope).toBe(runtimeScope);
      expect(result.executionContext).toEqual({
        runtimeIdentity: {
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        },
        project: runtimeScope.project,
        deployment: runtimeScope.deployment,
        manifest: runtimeScope.deployment.manifest,
        language: 'Simplified Chinese',
      });
    });

    it('passes through a custom no-deployment error message', async () => {
      await expect(
        deriveRuntimeExecutionContextFromRequest({
          req: { body: {} } as any,
          runtimeScopeResolver: {
            resolveRequestScope: jest.fn().mockResolvedValue({
              project: { id: 42, language: 'EN' },
              deployment: null,
            }),
          },
          noDeploymentMessage: 'custom deployment message',
        }),
      ).rejects.toThrow('custom deployment message');
    });

    it('rejects outdated snapshots when latest-only execution is required', async () => {
      const runtimeScope = {
        project: { id: 42, language: 'EN' },
        workspace: { id: 'workspace-1' },
        knowledgeBase: {
          id: 'kb-1',
          defaultKbSnapshotId: 'snapshot-latest',
        },
        kbSnapshot: { id: 'snapshot-old' },
        deployHash: 'deploy-old',
        deployment: {
          hash: 'deploy-old',
          manifest: { models: [] },
        },
        userId: 'user-1',
      } as any;

      await expect(
        deriveRuntimeExecutionContextFromRequest({
          req: { body: {} } as any,
          runtimeScopeResolver: {
            resolveRequestScope: jest.fn().mockResolvedValue(runtimeScope),
          },
          requireLatestExecutableSnapshot: true,
        }),
      ).rejects.toThrow('This snapshot is outdated and cannot be executed');
      await expect(
        deriveRuntimeExecutionContextFromRequest({
          req: { body: {} } as any,
          runtimeScopeResolver: {
            resolveRequestScope: jest.fn().mockResolvedValue(runtimeScope),
          },
          requireLatestExecutableSnapshot: true,
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'OUTDATED_RUNTIME_SNAPSHOT',
      });
    });

    it('rejects deploy-hash-only access when it no longer matches the latest snapshot', async () => {
      const runtimeScope = {
        project: null,
        workspace: { id: 'workspace-1' },
        knowledgeBase: null,
        kbSnapshot: null,
        deployHash: 'deploy-old',
        deployment: {
          projectId: 42,
          hash: 'deploy-old',
          manifest: { models: [] },
        },
        userId: 'user-1',
      } as any;
      mockFindKnowledgeBaseBy.mockResolvedValue({
        id: 'kb-1',
        runtimeProjectId: 42,
        defaultKbSnapshotId: 'snapshot-latest',
      });
      mockFindKbSnapshotBy.mockResolvedValue({
        id: 'snapshot-latest',
        deployHash: 'deploy-latest',
      });

      await expect(
        deriveRuntimeExecutionContextFromRequest({
          req: { body: {} } as any,
          runtimeScopeResolver: {
            resolveRequestScope: jest.fn().mockResolvedValue(runtimeScope),
          },
          requireLatestExecutableSnapshot: true,
        }),
      ).rejects.toThrow('This snapshot is outdated and cannot be executed');
      await expect(
        deriveRuntimeExecutionContextFromRequest({
          req: { body: {} } as any,
          runtimeScopeResolver: {
            resolveRequestScope: jest.fn().mockResolvedValue(runtimeScope),
          },
          requireLatestExecutableSnapshot: true,
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'OUTDATED_RUNTIME_SNAPSHOT',
      });
      expect(mockFindKnowledgeBaseBy).toHaveBeenCalledWith({
        runtimeProjectId: 42,
      });
      expect(mockFindKbSnapshotBy).toHaveBeenCalledWith({
        id: 'snapshot-latest',
      });
    });

    it('allows historical snapshots to resolve when latest-only execution is not requested', async () => {
      const runtimeScope = {
        project: { id: 42, language: 'EN' },
        workspace: { id: 'workspace-1' },
        knowledgeBase: {
          id: 'kb-1',
          defaultKbSnapshotId: 'snapshot-latest',
        },
        kbSnapshot: { id: 'snapshot-old' },
        deployHash: 'deploy-old',
        deployment: {
          hash: 'deploy-old',
          manifest: { models: [] },
        },
        userId: 'user-1',
      } as any;

      const result = await deriveRuntimeExecutionContextFromRequest({
        req: { body: {} } as any,
        runtimeScopeResolver: {
          resolveRequestScope: jest.fn().mockResolvedValue(runtimeScope),
        },
      });

      expect(result.runtimeScope).toBe(runtimeScope);
      expect(result.executionContext.deployment.hash).toBe('deploy-old');
    });

    it('falls back to projectService when runtime scope project is absent', async () => {
      const runtimeScope = {
        project: null,
        workspace: { id: 'workspace-1' },
        knowledgeBase: { id: 'kb-1' },
        kbSnapshot: { id: 'snapshot-1' },
        deployHash: 'deploy-1',
        deployment: {
          projectId: 42,
          hash: 'deploy-1',
          manifest: { models: [] },
        },
        userId: 'user-1',
      } as any;
      mockGetProjectById.mockResolvedValue({
        id: 42,
        language: 'EN',
      });

      const result = await deriveRuntimeExecutionContextFromRequest({
        req: { body: {} } as any,
        runtimeScopeResolver: {
          resolveRequestScope: jest.fn().mockResolvedValue(runtimeScope),
        },
      });

      expect(mockGetProjectById).toHaveBeenCalledWith(42);
      expect(result.executionContext).toEqual({
        runtimeIdentity: {
          projectId: null,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        },
        project: { id: 42, language: 'EN' },
        deployment: runtimeScope.deployment,
        manifest: runtimeScope.deployment.manifest,
        language: 'Simplified Chinese',
      });
    });

    it('prefers runtime knowledge base language when deriving execution context', async () => {
      const runtimeScope = {
        project: { id: 42, language: 'EN' },
        workspace: { id: 'workspace-1' },
        knowledgeBase: { id: 'kb-1', language: 'ZH_TW' },
        kbSnapshot: { id: 'snapshot-1' },
        deployHash: 'deploy-1',
        deployment: {
          hash: 'deploy-1',
          manifest: { models: [] },
        },
        userId: 'user-1',
      } as any;

      const result = await deriveRuntimeExecutionContextFromRequest({
        req: { body: {} } as any,
        runtimeScopeResolver: {
          resolveRequestScope: jest.fn().mockResolvedValue(runtimeScope),
        },
      });

      expect(result.executionContext).toEqual(
        expect.objectContaining({
          language: 'Traditional Chinese',
        }),
      );
    });
  });

  describe('validateSql', () => {
    it('validates sql using provided execution context instead of fetching deployment again', async () => {
      const queryService = {
        preview: jest.fn().mockResolvedValue({}),
      };
      const executionContext = {
        project: { id: 42 },
        manifest: { models: [] },
      };

      await validateSql('select 1', executionContext, queryService);

      expect(queryService.preview).toHaveBeenCalledWith('select 1', {
        manifest: executionContext.manifest,
        project: executionContext.project,
        dryRun: true,
      });
    });

    it('replaces colon-named parameters with dry-run literals before validation', async () => {
      const queryService = {
        preview: jest.fn().mockResolvedValue({}),
      };
      const executionContext = {
        project: { id: 42 },
        manifest: { models: [] },
      };
      const sql = `
        select *
        from orders
        where tenant_plat_id = :tenant_plat_id
          and biz_date >= :start_date
          and biz_date < :end_date
      `;

      await validateSql(sql, executionContext, queryService);

      expect(queryService.preview).toHaveBeenCalledWith(
        expect.stringContaining("tenant_plat_id = 0"),
        expect.objectContaining({
          manifest: executionContext.manifest,
          project: executionContext.project,
          dryRun: true,
        }),
      );
      expect(queryService.preview).toHaveBeenCalledWith(
        expect.stringContaining("biz_date >= DATE '2026-04-01'"),
        expect.any(Object),
      );
      expect(queryService.preview).toHaveBeenCalledWith(
        expect.stringContaining("biz_date < DATE '2026-04-01'"),
        expect.any(Object),
      );
    });
  });

  describe('prepareSqlForDryRunValidation', () => {
    it('keeps casts, comments, and quoted strings intact while replacing named parameters', () => {
      const sql = `
        select 'keep :literal' as note,
               created_at::timestamp as created_at
        from foo
        where tenant_plat_id = :tenant_plat_id
          and label = ":quoted"
          -- :commented_out
          and event_time >= :start_time
      `;

      expect(prepareSqlForDryRunValidation(sql)).toContain(
        "'keep :literal' as note",
      );
      expect(prepareSqlForDryRunValidation(sql)).toContain(
        'created_at::timestamp',
      );
      expect(prepareSqlForDryRunValidation(sql)).toContain(
        'tenant_plat_id = 0',
      );
      expect(prepareSqlForDryRunValidation(sql)).toContain(
        "event_time >= TIMESTAMP '2026-04-01 00:00:00'",
      );
      expect(prepareSqlForDryRunValidation(sql)).toContain('-- :commented_out');
      expect(prepareSqlForDryRunValidation(sql)).toContain('label = ":quoted"');
    });
  });
});
