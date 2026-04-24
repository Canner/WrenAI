import {
  type ComposeDiagram,
  type Diagram as RuntimeDiagram,
} from '@/utils/data';

export type DiagramNode = {
  id: string;
  position: {
    x: number;
    y: number;
  };
  width?: number;
  height?: number;
};

export type DiagramRefHandle = {
  fitView: () => void;
  getNodes: () => DiagramNode[];
  fitBounds: (bounds: {
    x: number;
    y: number;
    width?: number;
    height?: number;
  }) => void;
};

export type NormalizedDiagram = Omit<RuntimeDiagram, 'models' | 'views'> & {
  models: NonNullable<RuntimeDiagram['models'][number]>[];
  views: NonNullable<RuntimeDiagram['views'][number]>[];
};

type ModelingWorkspaceSearchParams = {
  get(name: string): string | null;
};

export const normalizeRuntimeDiagram = (
  diagram?: RuntimeDiagram | null,
): NormalizedDiagram | null => {
  if (!diagram) {
    return null;
  }

  return {
    ...diagram,
    models: (diagram.models || []).filter(
      (model): model is NonNullable<RuntimeDiagram['models'][number]> =>
        Boolean(model),
    ),
    views: (diagram.views || []).filter(
      (view): view is NonNullable<RuntimeDiagram['views'][number]> =>
        Boolean(view),
    ),
  };
};

export const readModelingWorkspaceQueryParams = (
  searchParams?: ModelingWorkspaceSearchParams | null,
) => ({
  modelId: searchParams?.get('modelId') || null,
  viewId: searchParams?.get('viewId') || null,
  openAssistant: searchParams?.get('openAssistant') || null,
  openMetadata: searchParams?.get('openMetadata') || null,
  openModelDrawer: searchParams?.get('openModelDrawer') || null,
  relationId: searchParams?.get('relationId') || null,
  openRelationModal: searchParams?.get('openRelationModal') || null,
});

export type ModelingMetadataSelection = ComposeDiagram;
