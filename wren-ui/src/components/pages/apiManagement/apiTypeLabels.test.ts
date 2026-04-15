import { ApiType } from '@/apollo/client/graphql/__types__';
import { API_HISTORY_FILTER_TYPES, formatApiTypeLabel } from './apiTypeLabels';

describe('apiManagement apiTypeLabels', () => {
  it('formats active api types with stable labels', () => {
    expect(formatApiTypeLabel(ApiType.RUN_SQL)).toBe('run_sql');
  });

  it('exposes current api types in filter options', () => {
    expect(API_HISTORY_FILTER_TYPES).toContain(ApiType.RUN_SQL);
    expect(API_HISTORY_FILTER_TYPES).not.toContain('TEST_SKILL' as any);
  });
});
