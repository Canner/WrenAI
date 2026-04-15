import {
  normalizeKnowledgeListPayload,
  resolveKnowledgeLoadErrorMessage,
} from './useKnowledgeDataLoaders';

describe('useKnowledgeDataLoaders helpers', () => {
  it('normalizes non-array payloads to empty array', () => {
    expect(normalizeKnowledgeListPayload({})).toEqual([]);
    expect(normalizeKnowledgeListPayload(null)).toEqual([]);
  });

  it('returns payload directly when payload is an array', () => {
    expect(normalizeKnowledgeListPayload([{ id: 'kb-1' }])).toEqual([
      { id: 'kb-1' },
    ]);
  });

  it('prefers explicit error messages', () => {
    expect(
      resolveKnowledgeLoadErrorMessage(new Error('custom-error'), 'fallback'),
    ).toBe('custom-error');
  });

  it('falls back to default message when error is not Error', () => {
    expect(resolveKnowledgeLoadErrorMessage('boom', 'fallback')).toBe(
      'fallback',
    );
  });
});
