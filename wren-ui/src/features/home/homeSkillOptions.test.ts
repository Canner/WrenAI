import {
  clearHomeSkillOptionsCacheForTests,
  fetchHomeSkillOptions,
  getCachedHomeSkillOptions,
  normalizeHomeSkillOptions,
  shouldLoadHomeSkillOptions,
} from './homeSkillOptions';

describe('homeSkillOptions utils', () => {
  const originalWindow = global.window;
  const originalFetch = global.fetch;

  const createStorage = () => {
    const store = new Map<string, string>();
    return {
      get length() {
        return store.size;
      },
      key: (index: number) => Array.from(store.keys())[index] || null,
      getItem: (key: string) => store.get(key) || null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    };
  };

  beforeEach(() => {
    const sessionStorage = createStorage();
    (global as typeof global & { window?: any }).window = {
      sessionStorage,
    } as any;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    clearHomeSkillOptionsCacheForTests();
    global.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (global as typeof global & { window?: any }).window;
    } else {
      (global as typeof global & { window?: any }).window = originalWindow;
    }
  });

  it('normalizes and sorts home skill options consistently', () => {
    expect(
      normalizeHomeSkillOptions([
        {
          id: 'skill-2',
          name: '订单助手',
          runtimeKind: 'assistant',
          sourceType: 'database',
          connectorId: 'connector-2',
          kbSuggestionIds: ['kb-2'],
        },
        {
          id: 'skill-1',
          name: '报表助手',
          runtimeKind: 'text-to-sql',
          sourceType: 'database',
          connectorId: null,
          kbSuggestionIds: null,
        },
      ]),
    ).toEqual([
      {
        id: 'skill-1',
        name: '报表助手',
        runtimeKind: 'text-to-sql',
        sourceType: 'database',
        knowledgeBaseIds: [],
        connectorCount: 0,
      },
      {
        id: 'skill-2',
        name: '订单助手',
        runtimeKind: 'assistant',
        sourceType: 'database',
        knowledgeBaseIds: ['kb-2'],
        connectorCount: 1,
      },
    ]);
  });

  it('returns cached options before hitting the network', async () => {
    window.sessionStorage.setItem(
      'wren.homeSkillOptions:workspace-1',
      JSON.stringify({
        value: [
          {
            id: 'skill-1',
            name: 'Revenue Helper',
            runtimeKind: 'assistant',
            sourceType: 'database',
            knowledgeBaseIds: ['kb-1'],
            connectorCount: 1,
          },
        ],
        updatedAt: Date.now(),
      }),
    );

    const result = await fetchHomeSkillOptions('workspace-1');

    expect(result).toEqual([
      expect.objectContaining({ id: 'skill-1', name: 'Revenue Helper' }),
    ]);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(getCachedHomeSkillOptions('workspace-1')).toEqual(result);
  });

  it('fetches, normalizes, and caches options on cache miss', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: 'skill-2',
            name: '订单助手',
            runtimeKind: 'assistant',
            sourceType: 'database',
            connectorId: 'connector-2',
            kbSuggestionIds: ['kb-2'],
          },
        ]),
        { status: 200 },
      ),
    );

    const result = await fetchHomeSkillOptions('workspace-1');

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/v1/skills/available?workspaceId=workspace-1',
    );
    expect(result).toEqual([
      expect.objectContaining({
        id: 'skill-2',
        knowledgeBaseIds: ['kb-2'],
        connectorCount: 1,
      }),
    ]);
    expect(getCachedHomeSkillOptions('workspace-1')).toEqual(result);
  });

  it('clears cached records written for tests', () => {
    window.sessionStorage.setItem(
      'wren.homeSkillOptions:workspace-1',
      JSON.stringify({ value: [], updatedAt: Date.now() }),
    );
    window.sessionStorage.setItem('other:key', 'persist');

    clearHomeSkillOptionsCacheForTests();

    expect(
      window.sessionStorage.getItem('wren.homeSkillOptions:workspace-1'),
    ).toBeNull();
    expect(window.sessionStorage.getItem('other:key')).toBe('persist');
  });

  it('enables loading only when workspace/runtime and picker intent allow it', () => {
    expect(
      shouldLoadHomeSkillOptions({
        workspaceId: 'workspace-1',
        hasExecutableRuntime: true,
        skillPickerOpen: false,
        selectedSkillCount: 0,
      }),
    ).toBe(false);
    expect(
      shouldLoadHomeSkillOptions({
        workspaceId: 'workspace-1',
        hasExecutableRuntime: true,
        skillPickerOpen: true,
        selectedSkillCount: 0,
      }),
    ).toBe(true);
    expect(
      shouldLoadHomeSkillOptions({
        workspaceId: 'workspace-1',
        hasExecutableRuntime: true,
        skillPickerOpen: false,
        selectedSkillCount: 1,
      }),
    ).toBe(true);
  });
});
