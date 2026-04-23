import {
  consumeThreadWorkbenchNavigationHint,
  primeThreadWorkbenchNavigationHint,
} from './threadWorkbenchNavigationHint';

const createSessionStorageMock = () => {
  const store = new Map<string, string>();

  return {
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
};

describe('threadWorkbenchNavigationHint', () => {
  const sessionStorage = createSessionStorageMock();

  beforeEach(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { sessionStorage },
    });
    sessionStorage.clear();
  });

  it('stores and consumes one-time workbench navigation hints by thread id', () => {
    primeThreadWorkbenchNavigationHint({
      threadId: 42,
      preferredArtifact: 'preview',
    });

    expect(consumeThreadWorkbenchNavigationHint(42)).toEqual({
      threadId: 42,
      preferredArtifact: 'preview',
    });
    expect(consumeThreadWorkbenchNavigationHint(42)).toBeNull();
  });

  it('ignores hints for a different thread id', () => {
    primeThreadWorkbenchNavigationHint({
      threadId: 7,
      preferredArtifact: 'preview',
    });

    expect(consumeThreadWorkbenchNavigationHint(42)).toBeNull();
    expect(consumeThreadWorkbenchNavigationHint(7)).toEqual({
      threadId: 7,
      preferredArtifact: 'preview',
    });
  });
});
