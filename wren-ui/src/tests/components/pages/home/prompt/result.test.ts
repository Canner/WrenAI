import { PROCESS_STATE } from '@/utils/enum';
import { AskingTaskType } from '@/types/home';
import { shouldCreateThreadResponseForPromptState } from '@/components/pages/home/prompt/resultUtils';

describe('shouldCreateThreadResponseForPromptState', () => {
  it('treats SEARCHING without explicit type as text-to-sql so follow-up response can be created', () => {
    expect(
      shouldCreateThreadResponseForPromptState({
        type: null,
        processState: PROCESS_STATE.SEARCHING,
      }),
    ).toBe(true);
  });

  it('does not create a thread response while still understanding the question', () => {
    expect(
      shouldCreateThreadResponseForPromptState({
        type: null,
        processState: PROCESS_STATE.UNDERSTANDING,
      }),
    ).toBe(false);
  });

  it('does not create a thread response for general answers', () => {
    expect(
      shouldCreateThreadResponseForPromptState({
        type: AskingTaskType.GENERAL,
        processState: PROCESS_STATE.FINISHED,
      }),
    ).toBe(false);
  });
});
