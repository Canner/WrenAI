import type { RefObject } from 'react';
import useDrawerAction from '@/hooks/useDrawerAction';
import useModalAction from '@/hooks/useModalAction';
import useRelationshipModal from '@/hooks/useRelationshipModal';
import type { ClientRuntimeScopeSelector } from '@/runtime/client/runtimeScope';
import { Path } from '@/utils/enum';
import type {
  DiagramRefHandle,
  NormalizedDiagram,
  readModelingWorkspaceQueryParams,
} from './modelingWorkspaceUtils';
import useModelingWorkspaceDiagramActions from './useModelingWorkspaceDiagramActions';
import useModelingWorkspaceNavigationEffects from './useModelingWorkspaceNavigationEffects';

type RunDiagramMutation = <T>(
  setLoadingState: (loading: boolean) => void,
  action: () => Promise<T>,
) => Promise<T>;

type RuntimeScopeNavigationLike = {
  selector: ClientRuntimeScopeSelector;
  replaceWorkspace: (
    path: Path,
    params?: Record<string, string | number | boolean>,
  ) => void;
};

export default function useModelingWorkspaceInteractions({
  diagramData,
  queryParams,
  metadataDrawer,
  modelDrawer,
  calculatedFieldModal,
  relationshipModal,
  diagramRef,
  isModelingReadonly,
  runDiagramMutation,
  refetchDiagram,
  refetchDeployStatus,
  runtimeScopeNavigation,
}: {
  diagramData: NormalizedDiagram | null;
  queryParams: ReturnType<typeof readModelingWorkspaceQueryParams>;
  metadataDrawer: ReturnType<typeof useDrawerAction>;
  modelDrawer: ReturnType<typeof useDrawerAction>;
  calculatedFieldModal: ReturnType<typeof useModalAction>;
  relationshipModal: ReturnType<typeof useRelationshipModal>;
  diagramRef: RefObject<DiagramRefHandle | null>;
  isModelingReadonly: boolean;
  runDiagramMutation: RunDiagramMutation;
  refetchDiagram: () => Promise<unknown>;
  refetchDeployStatus: () => Promise<unknown>;
  runtimeScopeNavigation: RuntimeScopeNavigationLike;
}) {
  const { onSelect } = useModelingWorkspaceNavigationEffects({
    diagramData,
    queryParams,
    metadataDrawer,
    modelDrawer,
    relationshipModal,
    diagramRef,
    runtimeScopeNavigation,
  });

  const {
    notifyModelingReadonly,
    onNodeClick,
    onMoreClick,
    onAddClick,
    buildRelationshipMutationInput,
  } = useModelingWorkspaceDiagramActions({
    diagramData,
    metadataDrawer,
    modelDrawer,
    calculatedFieldModal,
    relationshipModal,
    isModelingReadonly,
    runDiagramMutation,
    refetchDiagram,
    refetchDeployStatus,
    runtimeSelector: runtimeScopeNavigation.selector,
  });

  return {
    onSelect,
    onNodeClick,
    onMoreClick,
    onAddClick,
    notifyModelingReadonly,
    buildRelationshipMutationInput,
  };
}
