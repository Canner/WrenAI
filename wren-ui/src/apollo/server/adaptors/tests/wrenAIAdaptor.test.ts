import axios from 'axios';
import { WrenAIAdaptor } from '../wrenAIAdaptor';
import {
  AskInput,
  RecommendationQuestionsInput,
  RecommendationQuestionStatus,
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

  describe('deploy', () => {
    it('should send the project id to scope indexed semantics', async () => {
      const mockInput = {
        manifest: sampleManifest,
        hash: 'deploy-hash',
        projectId: 123,
      };
      mockedAxios.post.mockResolvedValueOnce({
        data: { id: mockInput.hash },
      });
      mockedAxios.get.mockResolvedValueOnce({
        data: { status: 'finished' },
      });

      await adaptor.deploy(mockInput);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        `${baseEndpoint}/v1/semantics-preparations`,
        {
          mdl: JSON.stringify(mockInput.manifest),
          id: mockInput.hash,
          project_id: mockInput.projectId.toString(),
        },
      );
      expect(mockedAxios.get).toHaveBeenCalledWith(
        `${baseEndpoint}/v1/semantics-preparations/${mockInput.hash}/status`,
        {
          params: {
            project_id: mockInput.projectId.toString(),
          },
        },
      );
    });
  });

  describe('ask', () => {
    const mockInput: AskInput = {
      query: 'Show active records',
      deployId: 'deploy-hash',
      projectId: 'project-123',
      histories: [],
      configurations: {
        language: 'English',
      },
    };

    it('should send the project id to scope AI retrieval', async () => {
      const mockQueryId = 'query-123';
      mockedAxios.post.mockResolvedValueOnce({
        data: { query_id: mockQueryId },
      });

      const result = await adaptor.ask(mockInput);

      expect(result).toEqual({ queryId: mockQueryId });
      expect(mockedAxios.post).toHaveBeenCalledWith(`${baseEndpoint}/v1/asks`, {
        query: mockInput.query,
        id: mockInput.deployId,
        project_id: mockInput.projectId,
        histories: [],
        configurations: mockInput.configurations,
      });
    });
  });

  describe('generateRecommendationQuestions', () => {
    const mockInput: RecommendationQuestionsInput = {
      manifest: sampleManifest,
      previousQuestions: ['What is sales by region?'],
      projectId: 'project-123',
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
          previous_questions: mockInput.previousQuestions,
          project_id: mockInput.projectId,
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
        `${baseEndpoint}/v1/question-recommendations/${queryId}/result`,
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
});
