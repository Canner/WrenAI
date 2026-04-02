import {
  canFetchThreadResponse,
  canGenerateAnswer,
  isReadyToThreadResponse,
} from './useAskPrompt';
import {
  AskingTaskStatus,
  AskingTaskType,
} from '@/apollo/client/graphql/__types__';

describe('useAskPrompt helpers', () => {
  it('does not trigger text answer generation for finished skill results', () => {
    expect(
      canGenerateAnswer(
        {
          status: AskingTaskStatus.FINISHED,
          type: AskingTaskType.SKILL,
        } as any,
        null,
      ),
    ).toBe(false);
  });

  it('treats finished skill results as ready thread responses', () => {
    expect(
      isReadyToThreadResponse({
        status: AskingTaskStatus.FINISHED,
        type: AskingTaskType.SKILL,
      } as any),
    ).toBe(true);
  });

  it('stops thread-response polling once a skill result is finished', () => {
    expect(
      canFetchThreadResponse({
        status: AskingTaskStatus.FINISHED,
        type: AskingTaskType.SKILL,
      } as any),
    ).toBe(false);
  });
});
