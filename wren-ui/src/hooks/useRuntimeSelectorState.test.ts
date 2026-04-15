import {
  buildRuntimeSelectorRequestOptions,
  buildRuntimeSelectorStateUrl,
} from './useRuntimeSelectorState';

describe('useRuntimeSelectorState helpers', () => {
  it('builds runtime selector REST url with runtime scope query params', () => {
    expect(
      buildRuntimeSelectorStateUrl({
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
      }),
    ).toBe(
      '/api/v1/runtime/scope/current?workspaceId=ws-1&knowledgeBaseId=kb-1&kbSnapshotId=snap-1',
    );
  });

  it('keeps runtimeScopeId when only bridge selector is available', () => {
    expect(
      buildRuntimeSelectorStateUrl({
        runtimeScopeId: 'scope-1',
      }),
    ).toBe('/api/v1/runtime/scope/current?runtimeScopeId=scope-1');
  });

  it('creates a plain GET request config and forwards the abort signal', () => {
    const controller = new AbortController();

    expect(
      buildRuntimeSelectorRequestOptions({
        signal: controller.signal,
      }),
    ).toEqual({
      method: 'GET',
      signal: controller.signal,
    });
  });
});
