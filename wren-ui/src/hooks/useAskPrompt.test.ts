import {
  buildRecommendedQuestionHistory,
  canFetchThreadResponse,
  canGenerateAnswer,
  isReadyToThreadResponse,
} from './useAskPrompt';
import { AskingTask, AskingTaskStatus, AskingTaskType } from '@/types/home';

describe('useAskPrompt helpers', () => {
  it('only triggers text answer generation for finished text-to-sql tasks', () => {
    expect(
      canGenerateAnswer(
        {
          status: AskingTaskStatus.FINISHED,
          type: AskingTaskType.TEXT_TO_SQL,
        } as AskingTask,
        null,
      ),
    ).toBe(true);
  });

  it('treats searching text-to-sql tasks as ready thread responses', () => {
    expect(
      isReadyToThreadResponse({
        status: AskingTaskStatus.SEARCHING,
        type: AskingTaskType.TEXT_TO_SQL,
      } as AskingTask),
    ).toBe(true);
  });

  it('continues thread-response polling until the task fails or stops', () => {
    expect(
      canFetchThreadResponse({
        status: AskingTaskStatus.FINISHED,
        type: AskingTaskType.TEXT_TO_SQL,
      } as AskingTask),
    ).toBe(true);
  });

  it('builds recommendation history with de-duplication and latest context', () => {
    expect(
      buildRecommendedQuestionHistory(
        ['问题1', '问题2', '问题2', '问题3'],
        '当前问题',
      ),
    ).toEqual(['问题1', '问题2', '问题3', '当前问题']);

    expect(buildRecommendedQuestionHistory([], '')).toEqual([]);
  });
});
