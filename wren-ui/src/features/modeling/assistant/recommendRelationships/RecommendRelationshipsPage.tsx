import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Empty,
  Popconfirm,
  Space,
  Spin,
  Table,
  Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { appMessage as message } from '@/utils/antdAppBridge';
import type {
  RelationFormValues,
  RelationFieldValue,
} from '@/components/modals/RelationModal';
import RelationModal from '@/components/modals/RelationModal';
import useModalAction from '@/hooks/useModalAction';
import useProtectedRuntimeScopePage from '@/hooks/useProtectedRuntimeScopePage';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';
import ModelingAssistantRouteLayout from '../ModelingAssistantRouteLayout';
import { buildModelingAssistantBackParams } from '../modelingAssistantRoutes';
import useModelingAssistantLeaveGuard from '../useModelingAssistantLeaveGuard';
import useModelingAssistantReadonly from '../useModelingAssistantReadonly';
import useRecommendRelationshipsTask from './useRecommendRelationshipsTask';
import { Path } from '@/utils/enum';
import { getJoinTypeText } from '@/utils/data';

const { Paragraph, Text } = Typography;

type SelectedRelationState = {
  modelName: string;
  relationKey: string;
  defaultValue: RelationFieldValue;
};

const buildRelationKey = (relation: RelationFieldValue) =>
  `${relation.fromField.fieldId}-${relation.toField.fieldId}-${relation.type}`;

const columns = ({
  modelName,
  onEdit,
  onDelete,
}: {
  modelName: string;
  onEdit: (payload: SelectedRelationState) => void;
  onDelete: (modelName: string, relationKey: string) => void;
}) => [
  {
    title: 'From',
    dataIndex: 'fromField',
    key: 'fromField',
    render: (value: any) => `${value.modelName}.${value.fieldName}`,
  },
  {
    title: 'To',
    dataIndex: 'toField',
    key: 'toField',
    render: (value: any) => `${value.modelName}.${value.fieldName}`,
  },
  {
    title: 'Type',
    dataIndex: 'type',
    key: 'type',
    render: (value: string) => getJoinTypeText(value),
  },
  {
    title: 'Description',
    dataIndex: 'properties',
    key: 'description',
    render: (value: Record<string, any> | undefined) =>
      value?.description || '-',
  },
  {
    title: '',
    key: 'actions',
    width: 96,
    render: (_: unknown, relation: RelationFieldValue) => {
      const relationKey = buildRelationKey(relation);
      return (
        <Space size={16}>
          <EditOutlined
            onClick={() =>
              onEdit({
                modelName,
                relationKey,
                defaultValue: relation,
              })
            }
          />
          <Popconfirm
            title="Confirm to delete?"
            okText="Delete"
            cancelText="Cancel"
            onConfirm={() => onDelete(modelName, relationKey)}
          >
            <DeleteOutlined />
          </Popconfirm>
        </Space>
      );
    },
  },
];

export default function RecommendRelationshipsPage() {
  const runtimeScopeNavigation = useRuntimeScopeNavigation();
  const runtimeScopePage = useProtectedRuntimeScopePage();
  const modelingAssistantReadonly = useModelingAssistantReadonly();
  const relationModal = useModalAction<RelationFieldValue>();
  const [selectedRelation, setSelectedRelation] =
    useState<SelectedRelationState | null>(null);

  const navigateBack = async () => {
    await runtimeScopeNavigation.pushWorkspace(
      Path.Knowledge,
      buildModelingAssistantBackParams(),
    );
  };

  const leaveGuard = useModelingAssistantLeaveGuard({
    onLeave: navigateBack,
  });

  const relationshipsTask = useRecommendRelationshipsTask({
    enabled:
      runtimeScopePage.hasRuntimeScope && !modelingAssistantReadonly.isReadOnly,
    selector: runtimeScopeNavigation.selector,
    onSaveSuccess: async () => {
      message.success('Relationships saved successfully.');
      await navigateBack();
    },
  });

  const tableBlocks = useMemo(
    () =>
      Object.entries(relationshipsTask.editedRelations).map(
        ([modelName, relations]) => (
          <div
            key={modelName}
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: 16,
              padding: 16,
              background: '#fff',
            }}
          >
            <Text strong style={{ display: 'block', marginBottom: 12 }}>
              {relationshipsTask.recommendNameMapping[modelName] || modelName}
            </Text>
            <Table
              rowKey={(relation) => buildRelationKey(relation)}
              columns={columns({
                modelName,
                onEdit: (payload) => {
                  setSelectedRelation(payload);
                  relationModal.openModal(payload.defaultValue);
                },
                onDelete: relationshipsTask.onDeleteRow,
              })}
              dataSource={relations}
              pagination={false}
            />
          </div>
        ),
      ),
    [
      relationModal,
      relationshipsTask.editedRelations,
      relationshipsTask.onDeleteRow,
      relationshipsTask.recommendNameMapping,
    ],
  );

  const renderContent = () => {
    if (runtimeScopePage.guarding || relationshipsTask.modelListLoading) {
      return (
        <div style={{ padding: '48px 0', textAlign: 'center' }}>
          <Spin />
        </div>
      );
    }

    if (modelingAssistantReadonly.isReadOnly) {
      return (
        <Alert
          type="warning"
          showIcon
          title="Modeling AI Assistant is unavailable on read-only snapshots"
          description={modelingAssistantReadonly.readOnlyHint}
        />
      );
    }

    if (relationshipsTask.requestError) {
      return (
        <Alert
          type="error"
          showIcon
          title="Failed to load relationship recommendations"
          description={relationshipsTask.requestError}
          action={
            <Button size="small" onClick={() => void relationshipsTask.retry()}>
              Retry
            </Button>
          }
        />
      );
    }

    if (!relationshipsTask.task) {
      return (
        <div style={{ padding: '48px 0', textAlign: 'center' }}>
          <Spin />
        </div>
      );
    }

    if (relationshipsTask.polling && !relationshipsTask.task?.response) {
      return (
        <div style={{ padding: '64px 0', textAlign: 'center' }}>
          <Spin size="large" />
          <Paragraph style={{ marginTop: 16, marginBottom: 0 }}>
            Generating... This may take up to a minute to generate the results.
          </Paragraph>
        </div>
      );
    }

    if (relationshipsTask.emptyState) {
      return (
        <div
          style={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
          }}
        >
          <Empty
            description={
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Text strong>No additional recommended relationships</Text>
                <Text type="secondary">No relationships are recommended.</Text>
              </div>
            }
          />
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <Text type="secondary">
              There are currently no relationship recommendations to apply.
            </Text>
            <Space>
              <Button onClick={() => void navigateBack()}>
                Cancel and Go Back
              </Button>
              <Button disabled>Save</Button>
            </Space>
          </div>
        </div>
      );
    }

    return (
      <div
        style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {tableBlocks}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 12,
          }}
        >
          <Button
            type="primary"
            onClick={() => void relationshipsTask.save()}
            loading={relationshipsTask.saving}
            disabled={!relationshipsTask.hasResult}
          >
            Save
          </Button>
        </div>
      </div>
    );
  };

  return (
    <>
      <ModelingAssistantRouteLayout
        title="Generate relationships"
        description="Modeling AI Assistant will use AI to discover potential connections between your models. Review the suggested relationships and adjust them before saving to your data models."
        onBack={leaveGuard.onBackClick}
      >
        {renderContent()}
      </ModelingAssistantRouteLayout>
      <RelationModal
        {...relationModal.state}
        onClose={() => {
          setSelectedRelation(null);
          relationModal.closeModal();
        }}
        onSubmit={async (values: RelationFormValues) => {
          if (!selectedRelation) {
            return;
          }
          relationshipsTask.onUpdateRelation({
            modelName: selectedRelation.modelName,
            originalRelationKey: selectedRelation.relationKey,
            values,
          });
          setSelectedRelation(null);
        }}
        model={selectedRelation?.defaultValue.fromField.modelName || ''}
        relations={relationshipsTask.editedRelations}
        defaultValue={selectedRelation?.defaultValue}
        isRecommendMode
        showDescriptionField
      />
    </>
  );
}
