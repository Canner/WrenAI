import { ApiType } from '@/apollo/client/graphql/__types__';
import {
  getAskDiagnostics,
  isAskApiHistoryType,
} from './askDiagnostics';

describe('apiManagement askDiagnostics helpers', () => {
  it('recognizes ask-based api types only', () => {
    expect(isAskApiHistoryType(ApiType.ASK)).toBe(true);
    expect(isAskApiHistoryType(ApiType.STREAM_ASK)).toBe(true);
    expect(isAskApiHistoryType(ApiType.RUN_SQL)).toBe(false);
    expect(isAskApiHistoryType(null)).toBe(false);
  });

  it('returns askDiagnostics payload only when it is a plain object', () => {
    expect(
      getAskDiagnostics({
        askDiagnostics: {
          askPath: 'skill',
          shadowCompare: {
            comparable: true,
            matched: true,
          },
        },
      }),
    ).toEqual({
      askPath: 'skill',
      shadowCompare: {
        comparable: true,
        matched: true,
      },
    });

    expect(getAskDiagnostics({ askDiagnostics: null })).toBeNull();
    expect(getAskDiagnostics({ askDiagnostics: 'skill' as any })).toBeNull();
    expect(getAskDiagnostics({ askDiagnostics: ['skill'] as any })).toBeNull();
    expect(getAskDiagnostics(undefined)).toBeNull();
  });
});
