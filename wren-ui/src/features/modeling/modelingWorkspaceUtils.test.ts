import {
  normalizeRuntimeDiagram,
  readModelingWorkspaceQueryParams,
} from './modelingWorkspaceUtils';

describe('modelingWorkspaceUtils', () => {
  it('normalizes runtime diagram collections by filtering null entries', () => {
    const normalized = normalizeRuntimeDiagram({
      models: [
        null,
        { id: 'model-1', fields: [], calculatedFields: [] },
      ] as any,
      views: [null, { id: 'view-1' }] as any,
    } as any);

    expect(normalized?.models).toHaveLength(1);
    expect(normalized?.views).toHaveLength(1);
  });

  it('reads modeling workspace deep-link query params from search params', () => {
    const searchParams = new URLSearchParams({
      modelId: '1',
      openMetadata: '1',
      relationId: '2',
    });

    expect(readModelingWorkspaceQueryParams(searchParams)).toEqual({
      modelId: '1',
      viewId: null,
      openMetadata: '1',
      openModelDrawer: null,
      relationId: '2',
      openRelationModal: null,
    });
  });
});
