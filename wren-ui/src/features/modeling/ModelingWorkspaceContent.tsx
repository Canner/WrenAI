import dynamic from 'next/dynamic';
import { forwardRef, type Key, type Ref, type RefObject } from 'react';
import type { RelationFormValues } from '@/components/modals/RelationModal';
import CalculatedFieldModal from '@/components/modals/CalculatedFieldModal';
import RelationModal from '@/components/modals/RelationModal';
import MetadataDrawer from '@/components/pages/modeling/MetadataDrawer';
import EditMetadataModal from '@/components/pages/modeling/EditMetadataModal';
import ModelDrawer from '@/components/pages/modeling/ModelDrawer';
import ModelingSidebar from '@/components/sidebar/Modeling';
import type { ClickPayload } from '@/components/diagram/Context';
import type useDrawerAction from '@/hooks/useDrawerAction';
import type useModalAction from '@/hooks/useModalAction';
import type useRelationshipModal from '@/hooks/useRelationshipModal';
import type {
  CreateModelInput,
  UpdateCalculatedFieldInput,
  UpdateModelInput,
  UpdateModelMetadataInput,
  UpdateViewMetadataInput,
} from '@/types/modeling';
import type { CreateCalculatedFieldInput } from '@/types/calculatedField';
import ModelingAssistantLauncher from './components/ModelingAssistantLauncher';
import {
  DiagramPanel,
  DiagramWrapper,
  ModelingSidebarPanel,
  ModelingStage,
} from './modelingWorkspaceLayout';
import type {
  DiagramRefHandle,
  NormalizedDiagram,
} from './modelingWorkspaceUtils';

const Diagram = dynamic<any>(() => import('@/components/diagram'), {
  ssr: false,
});

const ForwardDiagram = forwardRef<DiagramRefHandle, any>(
  function ForwardDiagram(props, ref) {
    return <Diagram {...props} forwardRef={ref} />;
  },
);

type ModelingWorkspaceContentProps = {
  embedded: boolean;
  diagramRef: RefObject<DiagramRefHandle | null>;
  diagramData: NormalizedDiagram | null;
  isModelingReadonly: boolean;
  metadataDrawer: ReturnType<typeof useDrawerAction>;
  editMetadataModal: ReturnType<typeof useModalAction>;
  calculatedFieldModal: ReturnType<typeof useModalAction>;
  modelDrawer: ReturnType<typeof useDrawerAction>;
  relationshipModal: ReturnType<typeof useRelationshipModal>;
  editMetadataLoading: boolean;
  modelLoading: boolean;
  calculatedFieldLoading: boolean;
  relationshipLoading: boolean;
  onOpenModelDrawer: () => void;
  onSelect: (selectKeys: Key[]) => void;
  onRefresh: (options?: { fitView?: boolean }) => Promise<unknown>;
  onMoreClick: (payload: ClickPayload) => void;
  onNodeClick: (payload: ClickPayload) => void;
  onAddClick: (payload: ClickPayload) => void;
  onOpenEditMetadata: (value: any) => void;
  onEditMetadataSubmit: (values: {
    nodeType: string;
    data: UpdateModelMetadataInput & {
      modelId?: number | string | null;
      viewId?: number | string | null;
    } & UpdateViewMetadataInput;
  }) => Promise<void>;
  onModelSubmit: (
    values:
      | { id: number; data: UpdateModelInput }
      | { id?: undefined; data: CreateModelInput },
  ) => Promise<void>;
  onCalculatedFieldSubmit: (
    values:
      | { id: number; data: UpdateCalculatedFieldInput }
      | { id?: undefined; data: CreateCalculatedFieldInput },
  ) => Promise<void>;
  onRelationshipSubmit: (
    values: RelationFormValues & { relationId?: number },
  ) => Promise<void>;
};

export default function ModelingWorkspaceContent({
  embedded,
  diagramRef,
  diagramData,
  isModelingReadonly,
  metadataDrawer,
  editMetadataModal,
  calculatedFieldModal,
  modelDrawer,
  relationshipModal,
  editMetadataLoading,
  modelLoading,
  calculatedFieldLoading,
  relationshipLoading,
  onOpenModelDrawer,
  onSelect,
  onRefresh,
  onMoreClick,
  onNodeClick,
  onAddClick,
  onOpenEditMetadata,
  onEditMetadataSubmit,
  onModelSubmit,
  onCalculatedFieldSubmit,
  onRelationshipSubmit,
}: ModelingWorkspaceContentProps) {
  return (
    <>
      <div style={{ marginBottom: 18 }}>
        {!isModelingReadonly ? <ModelingAssistantLauncher /> : null}
      </div>
      <ModelingStage $embedded={embedded}>
        <ModelingSidebarPanel $embedded={embedded}>
          {diagramData ? (
            <ModelingSidebar
              data={diagramData}
              onOpenModelDrawer={onOpenModelDrawer}
              onSelect={onSelect}
              readOnly={isModelingReadonly}
              onRefresh={onRefresh}
            />
          ) : null}
        </ModelingSidebarPanel>
        <DiagramPanel $embedded={embedded}>
          <DiagramWrapper>
            <ForwardDiagram
              ref={diagramRef as Ref<DiagramRefHandle>}
              data={diagramData}
              onMoreClick={onMoreClick}
              onNodeClick={onNodeClick}
              onAddClick={onAddClick}
              readOnly={isModelingReadonly}
            />
          </DiagramWrapper>
        </DiagramPanel>
      </ModelingStage>
      <MetadataDrawer
        {...(metadataDrawer.state as any)}
        onClose={metadataDrawer.closeDrawer}
        readOnly={isModelingReadonly}
        onEditClick={onOpenEditMetadata}
      />
      <EditMetadataModal
        {...(editMetadataModal.state as any)}
        onClose={editMetadataModal.closeModal}
        loading={editMetadataLoading}
        onSubmit={onEditMetadataSubmit}
      />
      <ModelDrawer
        {...(modelDrawer.state as any)}
        onClose={modelDrawer.closeDrawer}
        submitting={modelLoading}
        readOnly={isModelingReadonly}
        onSubmit={onModelSubmit}
      />
      <CalculatedFieldModal
        {...(calculatedFieldModal.state as any)}
        onClose={calculatedFieldModal.closeModal}
        loading={calculatedFieldLoading}
        onSubmit={onCalculatedFieldSubmit}
      />
      <RelationModal
        {...(relationshipModal.state as any)}
        onClose={relationshipModal.onClose}
        loading={relationshipLoading}
        onSubmit={onRelationshipSubmit}
      />
    </>
  );
}
