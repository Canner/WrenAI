import { RecommendationQuestionStatus } from '@server/models/adaptor';
import {
  buildRecommendationManifestForModel,
  createEmptyModelRecommendationState,
  mergeModelRecommendationState,
  readModelRecommendationState,
} from '../modelRecommendation';

describe('modelRecommendation utils', () => {
  it('returns an empty recommendation state when properties are missing', () => {
    expect(readModelRecommendationState(null)).toEqual(
      createEmptyModelRecommendationState(),
    );
  });

  it('merges recommendation state into model properties', () => {
    const properties = mergeModelRecommendationState({
      properties: JSON.stringify({ description: 'orders table' }),
      recommendation: {
        error: null,
        queryId: 'rq-1',
        questions: [
          {
            category: '分析',
            question: '按地区查看订单趋势',
            sql: 'select 1',
          },
        ],
        status: RecommendationQuestionStatus.FINISHED,
        updatedAt: '2026-04-20T12:00:00.000Z',
      },
    });

    expect(JSON.parse(properties)).toEqual({
      aiRecommendations: {
        error: null,
        queryId: 'rq-1',
        questions: [
          {
            category: '分析',
            question: '按地区查看订单趋势',
            sql: 'select 1',
          },
        ],
        status: 'FINISHED',
        updatedAt: '2026-04-20T12:00:00.000Z',
      },
      description: 'orders table',
    });
  });

  it('builds a single-model manifest for recommendation generation', () => {
    expect(
      buildRecommendationManifestForModel({
        manifest: {
          catalog: 'demo',
          dataSource: 'MYSQL' as any,
          models: [{ name: 'orders' }, { name: 'customers' }],
          relationships: [
            {
              name: 'orders_customers',
              models: ['orders', 'customers'],
            },
          ],
          views: [{ name: 'orders_view', statement: 'select * from orders' }],
        },
        modelName: 'orders',
      }),
    ).toEqual({
      catalog: 'demo',
      dataSource: 'MYSQL',
      models: [{ name: 'orders' }],
      relationships: [],
      views: [],
    });
  });
});
