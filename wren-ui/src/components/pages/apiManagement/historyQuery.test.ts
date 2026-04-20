import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { ApiType } from '@/types/apiHistory';
import {
  buildApiHistoryQueryParams,
  normalizeApiHistoryTableFilters,
  omitApiHistoryManagedQuery,
  readApiHistoryQueryState,
} from './historyQuery';

dayjs.extend(customParseFormat);

describe('apiManagement historyQuery helpers', () => {
  it('reads page, filters, and date range from URL query state', () => {
    const state = readApiHistoryQueryState({
      page: '3',
      apiType: ApiType.STREAM_ASK,
      statusCode: '400',
      threadId: 'thread-123',
      startDate: '2026-04-01',
      endDate: '2026-04-03',
    });

    expect(state.currentPage).toBe(3);
    expect(state.filters).toEqual({
      apiType: [ApiType.STREAM_ASK],
      statusCode: [400],
      threadId: ['thread-123'],
    });
    expect(state.dateRange?.[0].format('YYYY-MM-DD')).toBe('2026-04-01');
    expect(state.dateRange?.[1].format('YYYY-MM-DD')).toBe('2026-04-03');
  });

  it('ignores invalid values and falls back to defaults', () => {
    const state = readApiHistoryQueryState({
      page: '0',
      apiType: 'unknown',
      statusCode: 'abc',
      threadId: '  ',
      startDate: '2026-04-01',
      endDate: 'bad-date',
    });

    expect(state).toEqual({
      currentPage: 1,
      filters: {
        apiType: undefined,
        statusCode: undefined,
        threadId: undefined,
      },
      dateRange: null,
    });
  });

  it('serializes active state into shareable query params', () => {
    expect(
      buildApiHistoryQueryParams({
        currentPage: 2,
        filters: {
          apiType: [ApiType.ASK],
          statusCode: [200],
          threadId: ['thread-456'],
        },
        dateRange: [
          dayjs('2026-04-10', 'YYYY-MM-DD', true),
          dayjs('2026-04-12', 'YYYY-MM-DD', true),
        ],
      }),
    ).toEqual({
      page: '2',
      apiType: ApiType.ASK,
      statusCode: '200',
      threadId: 'thread-456',
      startDate: '2026-04-10',
      endDate: '2026-04-12',
    });
  });

  it('normalizes antd filter payloads and omits managed query keys', () => {
    expect(
      normalizeApiHistoryTableFilters({
        apiType: [ApiType.RUN_SQL],
        statusCode: ['500'],
        threadId: ['thread-789'],
      }),
    ).toEqual({
      apiType: [ApiType.RUN_SQL],
      statusCode: [500],
      threadId: ['thread-789'],
    });

    expect(
      omitApiHistoryManagedQuery({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        page: '4',
        apiType: ApiType.ASK,
        foo: 'bar',
      }),
    ).toEqual({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      foo: 'bar',
    });
  });
});
