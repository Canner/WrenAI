import { ThreadResponseAnswerStatus } from '../askingServiceShared';
import { generateThreadResponseAnswerAction } from '../askingServiceResponseActions';

describe('generateThreadResponseAnswerAction', () => {
  it('rejects answer generation when the response has no SQL', async () => {
    const service = {
      threadResponseRepository: {
        findOneBy: jest.fn().mockResolvedValue({
          id: 52,
          sql: null,
        }),
        updateOne: jest.fn(),
      },
      textBasedAnswerBackgroundTracker: {
        addTask: jest.fn(),
      },
    } as any;

    await expect(
      generateThreadResponseAnswerAction(service, 52),
    ).rejects.toThrow('Thread response 52 has no SQL');

    expect(service.threadResponseRepository.updateOne).not.toHaveBeenCalled();
    expect(
      service.textBasedAnswerBackgroundTracker.addTask,
    ).not.toHaveBeenCalled();
  });

  it('starts answer generation when SQL exists', async () => {
    const updatedThreadResponse = {
      id: 53,
      sql: 'select 1',
      answerDetail: {
        status: ThreadResponseAnswerStatus.NOT_STARTED,
      },
    };
    const service = {
      threadResponseRepository: {
        findOneBy: jest.fn().mockResolvedValue({
          id: 53,
          sql: 'select 1',
        }),
        updateOne: jest.fn().mockResolvedValue(updatedThreadResponse),
      },
      textBasedAnswerBackgroundTracker: {
        addTask: jest.fn(),
      },
    } as any;

    await expect(
      generateThreadResponseAnswerAction(service, 53),
    ).resolves.toEqual(updatedThreadResponse);

    expect(service.threadResponseRepository.updateOne).toHaveBeenCalledWith(
      53,
      {
        answerDetail: {
          status: ThreadResponseAnswerStatus.NOT_STARTED,
        },
      },
    );
    expect(
      service.textBasedAnswerBackgroundTracker.addTask,
    ).toHaveBeenCalledWith(updatedThreadResponse);
  });
});
