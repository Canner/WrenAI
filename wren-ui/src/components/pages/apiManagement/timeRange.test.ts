import moment from 'moment';
import {
  buildApiHistoryDateFilter,
  getApiHistoryDateRangePresets,
  hasApiHistoryDateRange,
} from './timeRange';

describe('apiManagement timeRange helpers', () => {
  it('builds inclusive start/end ISO filters from a selected date range', () => {
    const range = [
      moment.utc('2026-04-01T12:00:00Z'),
      moment.utc('2026-04-03T12:00:00Z'),
    ] as const;

    expect(buildApiHistoryDateFilter(range as any)).toEqual({
      startDate: '2026-04-01T00:00:00.000Z',
      endDate: '2026-04-03T23:59:59.999Z',
    });
  });

  it('returns empty filters when the range is unset', () => {
    expect(buildApiHistoryDateFilter(null)).toEqual({});
    expect(hasApiHistoryDateRange(null)).toBe(false);
  });

  it('builds quick range presets from the provided clock', () => {
    const now = moment.utc('2026-04-03T10:00:00Z');
    const ranges = getApiHistoryDateRangePresets(now);

    expect(Object.keys(ranges)).toEqual([
      'Last 24 hours',
      'Last 7 days',
      'Last 30 days',
    ]);
    expect(ranges['Last 24 hours'][0].toISOString()).toBe(
      '2026-04-02T10:00:00.000Z',
    );
    expect(ranges['Last 7 days'][0].toISOString()).toBe(
      '2026-03-28T00:00:00.000Z',
    );
    expect(ranges['Last 30 days'][1].toISOString()).toBe(
      '2026-04-03T23:59:59.999Z',
    );
  });
});
