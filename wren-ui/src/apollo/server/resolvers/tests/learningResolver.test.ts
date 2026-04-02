jest.mock('@server/config', () => ({
  getConfig: () => ({ userUUID: 'config-user' }),
}));

import { LearningResolver } from '../learningResolver';

describe('LearningResolver', () => {
  const createContext = (overrides: Record<string, any> = {}) =>
    ({
      runtimeScope: {
        userId: 'runtime-user',
      },
      learningRepository: {
        findAllBy: jest.fn().mockResolvedValue([]),
        createOne: jest.fn(),
        updateOne: jest.fn(),
      },
      ...overrides,
    }) as any;

  it('scopes learning record lookup to the active runtime user', async () => {
    const resolver = new LearningResolver();
    const ctx = createContext({
      learningRepository: {
        findAllBy: jest.fn().mockResolvedValue([{ paths: ['intro'] }]),
      },
    });

    const result = await resolver.getLearningRecord(null, null, ctx);

    expect(ctx.learningRepository.findAllBy).toHaveBeenCalledWith({
      userId: 'runtime-user',
    });
    expect(result).toEqual({ paths: ['intro'] });
  });

  it('falls back to configured user id when runtime scope is unavailable', async () => {
    const resolver = new LearningResolver();
    const ctx = createContext({
      runtimeScope: null,
      learningRepository: {
        findAllBy: jest.fn().mockResolvedValue([]),
      },
    });

    await resolver.getLearningRecord(null, null, ctx);

    expect(ctx.learningRepository.findAllBy).toHaveBeenCalledWith({
      userId: 'config-user',
    });
  });

  it('writes learning records under the active runtime user', async () => {
    const resolver = new LearningResolver();
    const ctx = createContext({
      learningRepository: {
        findAllBy: jest.fn().mockResolvedValue([]),
        createOne: jest.fn().mockResolvedValue({ id: 1, paths: ['intro'] }),
      },
    });

    await resolver.saveLearningRecord(
      null,
      { data: { path: 'intro' } },
      ctx,
    );

    expect(ctx.learningRepository.findAllBy).toHaveBeenCalledWith({
      userId: 'runtime-user',
    });
    expect(ctx.learningRepository.createOne).toHaveBeenCalledWith({
      userId: 'runtime-user',
      paths: ['intro'],
    });
  });
});

export {};
