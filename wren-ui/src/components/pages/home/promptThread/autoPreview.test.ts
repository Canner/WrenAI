import { resolveShouldAutoPreviewThreadResponse } from './autoPreview';

describe('PromptThread auto preview gating', () => {
  it('blocks auto preview for the last response on initial historical load', () => {
    expect(
      resolveShouldAutoPreviewThreadResponse({
        responseId: 11,
        isLastThreadResponse: true,
        initialBlockedPreviewResponseId: 11,
      }),
    ).toBe(false);
  });

  it('allows auto preview for newly created last responses after initial load', () => {
    expect(
      resolveShouldAutoPreviewThreadResponse({
        responseId: 12,
        isLastThreadResponse: true,
        initialBlockedPreviewResponseId: 11,
      }),
    ).toBe(true);
  });

  it('never auto previews non-last responses', () => {
    expect(
      resolveShouldAutoPreviewThreadResponse({
        responseId: 10,
        isLastThreadResponse: false,
        initialBlockedPreviewResponseId: 11,
      }),
    ).toBe(false);
  });
});
