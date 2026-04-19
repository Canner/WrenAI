import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import {
  buildKnowledgeModelingRouteParams,
  buildKnowledgeWorkbenchUrl,
  isKnowledgeWorkbenchRoute,
  isModelingSurfaceRoute,
  resolveKnowledgeWorkbenchRuntimeSelector,
} from '../../utils/knowledgeWorkbench';
import { Path } from '@/utils/enum';

describe('knowledgeWorkbench utils', () => {
  it('falls back to the provided runtime selector when knowledge base is missing', () => {
    expect(
      resolveKnowledgeWorkbenchRuntimeSelector({
        knowledgeBase: null,
        fallbackSelector: {
          workspaceId: 'ws-fallback',
          runtimeScopeId: 'scope-1',
        },
      }),
    ).toEqual({
      workspaceId: 'ws-fallback',
      runtimeScopeId: 'scope-1',
    });
  });

  it('builds canonical knowledge workbench selector from a knowledge base record', () => {
    expect(
      resolveKnowledgeWorkbenchRuntimeSelector({
        knowledgeBase: {
          id: 'kb-1',
          workspaceId: 'ws-1',
          defaultKbSnapshot: {
            id: 'snap-1',
            deployHash: 'deploy-1',
          },
        },
        fallbackSelector: { workspaceId: 'ws-fallback' },
      }),
    ).toEqual({
      workspaceId: 'ws-1',
      knowledgeBaseId: 'kb-1',
      kbSnapshotId: 'snap-1',
      deployHash: 'deploy-1',
    });
  });

  it('builds a knowledge workbench url with section params and runtime selector', () => {
    const buildRuntimeScopeUrl = jest.fn(
      (
        path: string,
        params?: Record<string, string | number | boolean | null | undefined>,
        selector?: ClientRuntimeScopeSelector,
      ) =>
        JSON.stringify({
          path,
          params,
          selector,
        }),
    );

    const url = buildKnowledgeWorkbenchUrl({
      buildRuntimeScopeUrl,
      knowledgeBase: {
        id: 'kb-1',
        workspaceId: 'ws-1',
        defaultKbSnapshot: {
          id: 'snap-1',
          deployHash: 'deploy-1',
        },
      },
      fallbackSelector: { workspaceId: 'fallback-ws' },
      section: 'modeling',
      extraParams: { openModelDrawer: 1 },
    });

    expect(buildRuntimeScopeUrl).toHaveBeenCalledWith(
      '/knowledge',
      {
        section: 'modeling',
        openModelDrawer: 1,
      },
      {
        workspaceId: 'ws-1',
        knowledgeBaseId: 'kb-1',
        kbSnapshotId: 'snap-1',
        deployHash: 'deploy-1',
      },
    );
    expect(url).toContain('modeling');
  });

  it('preserves modeling deep-link params only for known keys', () => {
    expect(
      buildKnowledgeModelingRouteParams({
        viewId: '42',
        openMetadata: '1',
        ignored: 'x',
      }),
    ).toEqual({
      section: 'modeling',
      viewId: '42',
      openMetadata: '1',
    });
  });

  it('detects knowledge workbench routes by pathname', () => {
    expect(isKnowledgeWorkbenchRoute(Path.Knowledge)).toBe(true);
    expect(isKnowledgeWorkbenchRoute(`${Path.Knowledge}/child`)).toBe(true);
    expect(isKnowledgeWorkbenchRoute(Path.Modeling)).toBe(false);
  });

  it('treats legacy modeling and knowledge modeling section as one modeling surface', () => {
    expect(
      isModelingSurfaceRoute({
        pathname: Path.Modeling,
      }),
    ).toBe(true);

    expect(
      isModelingSurfaceRoute({
        pathname: Path.Knowledge,
        query: { section: 'modeling' },
      }),
    ).toBe(true);

    expect(
      isModelingSurfaceRoute({
        pathname: Path.Knowledge,
        query: { section: 'overview' },
      }),
    ).toBe(false);
  });
});
