import axios from 'axios';
import { WrenAIAdaptor } from '../wrenAIAdaptor';
import {
  AskResultStatus,
  AskResultType,
  RecommendationQuestionsInput,
  RecommendationQuestionStatus,
  SkillResultType,
} from '@server/models/adaptor';
import { Manifest } from '../../mdl/type';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const sampleManifest: Manifest = {
  models: [
    {
      name: 'model1',
      columns: [
        {
          name: 'column1',
          type: 'string',
          isCalculated: false,
        },
      ],
    },
  ],
};

describe('WrenAIAdaptor', () => {
  const baseEndpoint = 'http://test-endpoint';
  let adaptor: WrenAIAdaptor;

  beforeEach(() => {
    adaptor = new WrenAIAdaptor({ wrenAIBaseEndpoint: baseEndpoint });
    jest.clearAllMocks();
  });

  describe('generateRecommendationQuestions', () => {
    const mockInput: RecommendationQuestionsInput = {
      manifest: sampleManifest,
      runtimeScopeId: 'runtime-scope-1',
      runtimeIdentity: {
        workspaceId: 'workspace-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snapshot-1',
        deployHash: 'deploy-1',
      },
      previousQuestions: ['What is sales by region?'],
      maxQuestions: 5,
      maxCategories: 3,
      configuration: {
        language: 'English',
      },
    };

    it('should successfully generate recommendation questions', async () => {
      const mockQueryId = 'query-123';
      mockedAxios.post.mockResolvedValueOnce({ data: { id: mockQueryId } });

      const result = await adaptor.generateRecommendationQuestions(mockInput);

      expect(result).toEqual({ queryId: mockQueryId });
      expect(mockedAxios.post).toHaveBeenCalledWith(
        `${baseEndpoint}/v1/question-recommendations`,
        {
          mdl: JSON.stringify(mockInput.manifest),
          runtime_scope_id: 'runtime-scope-1',
          runtime_identity: expect.objectContaining({
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: 'deploy-1',
          }),
          previous_questions: mockInput.previousQuestions,
          max_questions: mockInput.maxQuestions,
          max_categories: mockInput.maxCategories,
          configuration: mockInput.configuration,
        },
      );
    });

    it('should handle errors when generating recommendation questions', async () => {
      const errorMessage = 'Network error';
      mockedAxios.post.mockRejectedValueOnce(new Error(errorMessage));

      await expect(
        adaptor.generateRecommendationQuestions(mockInput),
      ).rejects.toThrow(errorMessage);
    });
  });

  describe('ask', () => {
    it('should forward runtime and skill context to ai-service', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { query_id: 'query-ask-1' },
      });

      const result = await adaptor.ask({
        query: '本月 GMV',
        deployId: 'deploy-1',
        runtimeScopeId: 'runtime-scope-1',
        configurations: { language: 'English' },
        runtimeIdentity: {
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        },
        actorClaims: {
          userId: 'user-1',
          workspaceMemberId: 'member-1',
          roleKeys: ['owner'],
          permissionScopes: ['knowledge_base:*'],
        },
        connectors: [
          {
            id: 'connector-1',
            type: 'postgres',
            displayName: 'Warehouse',
            config: { schema: 'public' },
            metadata: { workspaceId: 'workspace-1' },
          },
        ],
        secrets: [
          {
            id: 'secret-1',
            name: 'Warehouse Secret',
            values: { password: 'test' },
            redactedKeys: ['password'],
          },
        ],
        skills: [
          {
            skillId: 'skill-1',
            skillName: 'sales_skill',
            runtimeKind: 'isolated_python',
            sourceType: 'inline',
            sourceRef: 'skills/sales',
            entrypoint: 'main.py',
            skillConfig: { timeoutSec: 15 },
          },
        ],
      });

      expect(result).toEqual({ queryId: 'query-ask-1' });
      expect(mockedAxios.post).toHaveBeenCalledWith(
        `${baseEndpoint}/v1/asks`,
        expect.objectContaining({
          query: '本月 GMV',
          id: 'deploy-1',
          runtime_scope_id: 'runtime-scope-1',
          runtime_identity: expect.objectContaining({
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
          }),
          actor_claims: expect.objectContaining({
            userId: 'user-1',
            workspaceMemberId: 'member-1',
          }),
          connectors: [
            expect.objectContaining({
              id: 'connector-1',
              displayName: 'Warehouse',
            }),
          ],
          secrets: [
            expect.objectContaining({
              id: 'secret-1',
              name: 'Warehouse Secret',
            }),
          ],
          skills: [
            expect.objectContaining({
              skillId: 'skill-1',
              skillName: 'sales_skill',
              skillConfig: { timeoutSec: 15 },
            }),
          ],
        }),
      );
      expect(mockedAxios.post.mock.calls[0]?.[1]).not.toHaveProperty(
        'project_id',
      );
    });
  });

  describe('deploy', () => {
    it('should send runtime identity when preparing semantics', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { id: 'deploy-1' } });
      mockedAxios.get.mockResolvedValueOnce({ data: { status: 'finished' } });

      const result = await adaptor.deploy({
        manifest: sampleManifest,
        hash: 'deploy-1',
        runtimeIdentity: {
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          deployHash: 'deploy-1',
        },
      });

      expect(result).toEqual({ status: 'SUCCESS' });
      expect(mockedAxios.post).toHaveBeenCalledWith(
        `${baseEndpoint}/v1/semantics-preparations`,
        expect.objectContaining({
          id: 'deploy-1',
          runtime_identity: expect.objectContaining({
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            deployHash: 'deploy-1',
          }),
        }),
      );
      const requestBody = mockedAxios.post.mock.calls[0]?.[1] as any;
      expect(requestBody?.runtime_identity?.projectBridgeId).toBeUndefined();
    });
  });

  describe('delete semantics', () => {
    it('should send runtime identity in delete body', async () => {
      mockedAxios.delete.mockResolvedValueOnce({ status: 200, data: {} });

      await adaptor.delete({
        runtimeIdentity: {
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
          actorUserId: 'user-1',
        },
      });

      expect(mockedAxios.delete).toHaveBeenCalledWith(
        `${baseEndpoint}/v1/semantics`,
        expect.objectContaining({
          data: expect.objectContaining({
            runtime_identity: expect.objectContaining({
              workspaceId: 'workspace-1',
              knowledgeBaseId: 'kb-1',
              kbSnapshotId: 'snapshot-1',
              deployHash: 'deploy-1',
              actorUserId: 'user-1',
            }),
          }),
        }),
      );
    });
  });

  describe('runtime-identity-first maintenance APIs', () => {
    it('should deploy sql pairs with runtime identity instead of top-level project_id', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { event_id: 'event-1' } });

      const result = await adaptor.deploySqlPair({
        runtimeIdentity: {
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
        },
        sqlPair: {
          id: 7,
          question: '本月 GMV 是多少？',
          sql: 'SELECT 1',
        },
      });

      expect(result).toEqual({ queryId: 'event-1' });
      expect(mockedAxios.post).toHaveBeenCalledWith(
        `${baseEndpoint}/v1/sql-pairs`,
        expect.objectContaining({
          runtime_identity: {
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: 'deploy-1',
          },
        }),
      );
      expect(mockedAxios.post.mock.calls[0]?.[1]).not.toHaveProperty(
        'project_id',
      );
    });

    it('should delete sql pairs with runtime identity instead of top-level project_id', async () => {
      mockedAxios.delete.mockResolvedValueOnce({ status: 200, data: {} });

      await adaptor.deleteSqlPairs({
        runtimeIdentity: {
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
        },
        sqlPairIds: [7, 8],
      });

      expect(mockedAxios.delete).toHaveBeenCalledWith(
        `${baseEndpoint}/v1/sql-pairs`,
        expect.objectContaining({
          data: expect.objectContaining({
            sql_pair_ids: ['7', '8'],
            runtime_identity: {
              workspaceId: 'workspace-1',
              knowledgeBaseId: 'kb-1',
              kbSnapshotId: 'snapshot-1',
              deployHash: 'deploy-1',
            },
          }),
        }),
      );
    });

    it('should deploy instructions with runtime identity instead of top-level project_id', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { event_id: 'event-2' } });

      const result = await adaptor.generateInstruction({
        instructions: [
          {
            id: 9,
            instruction: '仅统计已支付订单',
            questions: ['本月订单'],
            isDefault: false,
          },
        ],
        runtimeIdentity: {
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
        },
      });

      expect(result).toEqual({ queryId: 'event-2' });
      expect(mockedAxios.post).toHaveBeenCalledWith(
        `${baseEndpoint}/v1/instructions`,
        expect.objectContaining({
          runtime_identity: {
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            kbSnapshotId: 'snapshot-1',
            deployHash: 'deploy-1',
          },
        }),
      );
      expect(mockedAxios.post.mock.calls[0]?.[1]).not.toHaveProperty(
        'project_id',
      );
    });

    it('should delete instructions with runtime identity instead of top-level project_id', async () => {
      mockedAxios.delete.mockResolvedValueOnce({ status: 200, data: {} });

      await adaptor.deleteInstructions({
        ids: [9],
        runtimeIdentity: {
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
        },
      });

      expect(mockedAxios.delete).toHaveBeenCalledWith(
        `${baseEndpoint}/v1/instructions`,
        expect.objectContaining({
          data: expect.objectContaining({
            instruction_ids: ['9'],
            runtime_identity: {
              workspaceId: 'workspace-1',
              knowledgeBaseId: 'kb-1',
              kbSnapshotId: 'snapshot-1',
              deployHash: 'deploy-1',
            },
          }),
        }),
      );
    });

    it('should reject semantics preparation without runtime identity', async () => {
      await expect(
        adaptor.deploy({
          manifest: sampleManifest,
          hash: 'deploy-1',
        }),
      ).resolves.toEqual({
        status: 'FAILED',
        error: expect.stringContaining('Runtime identity is required'),
      });
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('should reject instruction generation without runtime identity', async () => {
      await expect(
        adaptor.generateInstruction({
          instructions: [
            {
              id: 9,
              instruction: '仅统计已支付订单',
              questions: ['本月订单'],
              isDefault: false,
            },
          ],
        }),
      ).rejects.toThrow('Runtime identity is required');
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('should keep projectBridgeId when runtime identity only contains the legacy bridge', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { event_id: 'event-legacy' },
      });

      await adaptor.deploySqlPair({
        runtimeIdentity: {
          projectId: 42,
        },
        sqlPair: {
          id: 7,
          question: 'legacy project only',
          sql: 'SELECT 1',
        },
      });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        `${baseEndpoint}/v1/sql-pairs`,
        expect.objectContaining({
          runtime_identity: expect.objectContaining({
            projectBridgeId: '42',
          }),
        }),
      );
    });

    it('should prefer canonical runtime fields over projectBridgeId when both are present', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { event_id: 'event-canonical' },
      });

      await adaptor.deploySqlPair({
        runtimeIdentity: {
          projectId: 42,
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          deployHash: 'deploy-1',
        },
        sqlPair: {
          id: 8,
          question: 'canonical beats legacy bridge',
          sql: 'SELECT 1',
        },
      });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        `${baseEndpoint}/v1/sql-pairs`,
        expect.objectContaining({
          runtime_identity: expect.objectContaining({
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
            deployHash: 'deploy-1',
            projectBridgeId: undefined,
          }),
        }),
      );
    });

    it('should create ask feedback with runtime identity instead of top-level project_id', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { query_id: 'query-fb-1' },
      });

      const result = await adaptor.createAskFeedback({
        question: '本月 GMV',
        tables: ['orders'],
        sqlGenerationReasoning: '需要限定已支付订单',
        sql: 'SELECT 1',
        runtimeIdentity: {
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          kbSnapshotId: 'snapshot-1',
          deployHash: 'deploy-1',
        },
        configurations: { language: 'English' },
      });

      expect(result).toEqual({ queryId: 'query-fb-1' });
      expect(mockedAxios.post).toHaveBeenCalledWith(
        `${baseEndpoint}/v1/ask-feedbacks`,
        expect.objectContaining({
          runtime_identity: expect.objectContaining({
            workspaceId: 'workspace-1',
            knowledgeBaseId: 'kb-1',
          }),
        }),
      );
      expect(mockedAxios.post.mock.calls[0]?.[1]).not.toHaveProperty(
        'project_id',
      );
    });

    it('should generate charts with runtime identity instead of top-level project_id', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { query_id: 'chart-1' } });

      const result = await adaptor.generateChart({
        query: '本月 GMV',
        sql: 'SELECT 1',
        runtimeIdentity: {
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          deployHash: 'deploy-1',
        },
        configurations: { language: 'English' },
      });

      expect(result).toEqual({ queryId: 'chart-1' });
      expect(mockedAxios.post).toHaveBeenCalledWith(
        `${baseEndpoint}/v1/charts`,
        expect.objectContaining({
          runtime_identity: expect.objectContaining({
            deployHash: 'deploy-1',
          }),
        }),
      );
      expect(mockedAxios.post.mock.calls[0]?.[1]).not.toHaveProperty(
        'project_id',
      );
    });

    it('should adjust charts with runtime identity instead of top-level project_id', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { query_id: 'chart-adjustment-1' },
      });

      const result = await adaptor.adjustChart({
        query: '本月 GMV',
        sql: 'SELECT 1',
        adjustmentOption: { chartType: 'bar' as any },
        chartSchema: { mark: 'bar' },
        runtimeIdentity: {
          workspaceId: 'workspace-1',
          knowledgeBaseId: 'kb-1',
          deployHash: 'deploy-1',
        },
        configurations: { language: 'English' },
      });

      expect(result).toEqual({ queryId: 'chart-adjustment-1' });
      expect(mockedAxios.post).toHaveBeenCalledWith(
        `${baseEndpoint}/v1/chart-adjustments`,
        expect.objectContaining({
          runtime_identity: expect.objectContaining({
            deployHash: 'deploy-1',
          }),
        }),
      );
    });
  });

  describe('getRecommendationQuestionsResult', () => {
    const queryId = 'query-123';

    it('should successfully get recommendation questions result', async () => {
      const mockResponse = {
        status: 'FINISHED',
        response: {
          questions: [
            {
              question: 'What is the total revenue?',
              explanation: 'This shows overall business performance',
              category: 'Revenue',
            },
          ],
        },
      };

      mockedAxios.get.mockResolvedValueOnce({ data: mockResponse });

      const result = await adaptor.getRecommendationQuestionsResult(queryId);

      expect(result).toEqual({
        status: RecommendationQuestionStatus.FINISHED,
        error: null,
        ...mockResponse,
      });
      expect(mockedAxios.get).toHaveBeenCalledWith(
        `${baseEndpoint}/v1/question-recommendations/${queryId}`,
      );
    });

    it('should handle errors when getting recommendation questions result', async () => {
      const errorMessage = 'Network error';
      mockedAxios.get.mockRejectedValueOnce(new Error(errorMessage));

      await expect(
        adaptor.getRecommendationQuestionsResult(queryId),
      ).rejects.toThrow(errorMessage);
    });
  });

  describe('getAskResult', () => {
    it('should transform skill results from ai-service', async () => {
      mockedAxios.get.mockResolvedValueOnce({
        data: {
          status: 'finished',
          type: 'SKILL',
          ask_path: 'skill',
          shadow_compare: {
            enabled: true,
            executed: true,
            comparable: false,
            primary_type: 'SKILL',
            shadow_type: 'TEXT_TO_SQL',
            primary_ask_path: 'skill',
            shadow_ask_path: 'nl2sql',
            shadow_error_type: '',
            shadow_sql: 'SELECT 1',
            shadow_result_count: 1,
            matched: false,
          },
          skill_result: {
            result_type: 'text',
            text: '本月 GMV 为 128 万',
            trace: {
              skill_run_id: 'run-1',
              runner_job_id: 'exec-1',
            },
          },
        },
      });

      const result = await adaptor.getAskResult('query-skill-1');

      expect(result.status).toBe(AskResultStatus.FINISHED);
      expect(result.type).toBe(AskResultType.SKILL);
      expect(result.askPath).toBe('skill');
      expect(result.shadowCompare?.executed).toBe(true);
      expect(result.shadowCompare?.comparable).toBe(false);
      expect(result.shadowCompare?.primaryType).toBe('SKILL');
      expect(result.shadowCompare?.shadowType).toBe('TEXT_TO_SQL');
      expect(result.shadowCompare?.shadowAskPath).toBe('nl2sql');
      expect(result.shadowCompare?.shadowSql).toBe('SELECT 1');
      expect(result.shadowCompare?.shadowResultCount).toBe(1);
      expect(result.shadowCompare?.matched).toBe(false);
      expect(result.skillResult?.resultType).toBe(SkillResultType.TEXT);
      expect(result.skillResult?.text).toBe('本月 GMV 为 128 万');
      expect(result.skillResult?.trace?.skillRunId).toBe('run-1');
      expect(result.skillResult?.trace?.runnerJobId).toBe('exec-1');
    });
  });
});
