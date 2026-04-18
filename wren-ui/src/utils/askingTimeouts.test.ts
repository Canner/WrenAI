import { ANSWER_FINALIZATION_POLL_TIMEOUT_MS } from './askingTimeouts';

describe('ANSWER_FINALIZATION_POLL_TIMEOUT_MS', () => {
  it('stays above the backend fetch + stream budget', () => {
    expect(ANSWER_FINALIZATION_POLL_TIMEOUT_MS).toBe(165_000);
    expect(ANSWER_FINALIZATION_POLL_TIMEOUT_MS).toBeGreaterThan(
      30_000 + 120_000,
    );
  });
});
