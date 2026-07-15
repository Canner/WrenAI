import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { useSearchParams } from 'next/navigation';
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Dropdown,
  Input,
  Menu,
  Modal,
  Select,
  Table,
  message,
} from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import { gql, useApolloClient, useMutation } from '@apollo/client';
import styled from 'styled-components';
import { MORE_ACTION, NODE_TYPE } from '@/utils/enum';
import { editCalculatedField } from '@/utils/modelingHelper';
import SiderLayout from '@/components/layouts/SiderLayout';
import MetadataDrawer from '@/components/pages/modeling/MetadataDrawer';
import EditMetadataModal from '@/components/pages/modeling/EditMetadataModal';
import CalculatedFieldModal from '@/components/modals/CalculatedFieldModal';
import ModelDrawer from '@/components/pages/modeling/ModelDrawer';
import RelationModal, {
  RelationFormValues,
} from '@/components/modals/RelationModal';
import useDrawerAction from '@/hooks/useDrawerAction';
import useModalAction from '@/hooks/useModalAction';
import useRelationshipModal from '@/hooks/useRelationshipModal';
import { convertFormValuesToIdentifier } from '@/hooks/useCombineFieldOptions';
import { ClickPayload } from '@/components/diagram/Context';
import { DeployStatusContext } from '@/components/deploy/Context';
import { DIAGRAM } from '@/apollo/client/graphql/diagram';
import { LIST_MODELS } from '@/apollo/client/graphql/model';
import { useDiagramQuery } from '@/apollo/client/graphql/diagram.generated';
import { useDeployStatusQuery } from '@/apollo/client/graphql/deploy.generated';
import { useDeleteViewMutation } from '@/apollo/client/graphql/view.generated';
import {
  useCreateModelMutation,
  useDeleteModelMutation,
  useUpdateModelMutation,
} from '@/apollo/client/graphql/model.generated';
import {
  useUpdateModelMetadataMutation,
  useUpdateViewMetadataMutation,
} from '@/apollo/client/graphql/metadata.generated';
import {
  useCreateCalculatedFieldMutation,
  useUpdateCalculatedFieldMutation,
  useDeleteCalculatedFieldMutation,
} from '@/apollo/client/graphql/calculatedField.generated';
import {
  useCreateRelationshipMutation,
  useDeleteRelationshipMutation,
  useUpdateRelationshipMutation,
} from '@/apollo/client/graphql/relationship.generated';
import * as events from '@/utils/events';

const GENERATE_MODELING_SEMANTICS = gql`
  mutation GenerateModelingSemantics($data: GenerateModelingSemanticsInput!) {
    generateModelingSemantics(data: $data)
  }
`;

const MODELING_SEMANTICS_RESULT = gql`
  query ModelingSemanticsResult($queryId: String!) {
    modelingSemanticsResult(queryId: $queryId)
  }
`;

const GENERATE_MODELING_RELATIONSHIPS = gql`
  mutation GenerateModelingRelationships {
    generateModelingRelationships
  }
`;

const MODELING_RELATIONSHIPS_RESULT = gql`
  query ModelingRelationshipsResult($queryId: String!) {
    modelingRelationshipsResult(queryId: $queryId)
  }
`;

const Diagram = dynamic(() => import('@/components/diagram'), { ssr: false });
// https://github.com/vercel/next.js/issues/4957#issuecomment-413841689
const ForwardDiagram = forwardRef(function ForwardDiagram(props: any, ref) {
  return <Diagram {...props} forwardRef={ref} />;
});

const DiagramWrapper = styled.div`
  position: relative;
  height: 100%;
`;

const AssistantAction = styled.div`
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 10;
`;

const AssistantPage = styled.div`
  min-height: calc(100vh - 48px);
  background: #f5f5f5;
  padding: 72px 24px;
`;

const AssistantCard = styled.div`
  max-width: 1060px;
  margin: 0 auto;
  padding: 34px 72px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 2px;
`;

const AssistantBack = styled.button`
  display: block;
  max-width: 1060px;
  margin: 0 auto 8px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #5f6368;
  cursor: pointer;
`;

const AssistantTitle = styled.h1`
  margin: 0 0 14px;
  color: #3c4043;
  font-size: 40px;
  line-height: 1.2;
`;

const AssistantDescription = styled.p`
  margin: 0 0 26px;
  color: #5f6368;
  line-height: 1.6;
`;

const AssistantFooter = styled.div`
  display: flex;
  justify-content: space-between;
  margin-top: 28px;
`;

const SemanticReviewCard = styled.div`
  padding: 18px 16px 28px;
  border-bottom: 1px solid #e5e7eb;

  &:last-child {
    border-bottom: 0;
  }
`;

export default function Modeling() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const apolloClient = useApolloClient();
  const diagramRef = useRef(null);
  const [assistantMode, setAssistantMode] = useState<
    'semantics' | 'relationships' | null
  >(null);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [semanticPrompt, setSemanticPrompt] = useState('');
  const [semanticStep, setSemanticStep] = useState<'pick' | 'generate' | 'review'>(
    'pick',
  );
  const [semanticSearch, setSemanticSearch] = useState('');
  const [semanticResult, setSemanticResult] = useState<any[]>([]);
  const [relationshipResult, setRelationshipResult] = useState<any[]>([]);

  const { data } = useDiagramQuery({
    fetchPolicy: 'cache-and-network',
    onCompleted: () => {
      diagramRef.current?.fitView();
    },
  });

  const deployStatusQueryResult = useDeployStatusQuery({
    pollInterval: 1000,
    fetchPolicy: 'no-cache',
  });

  const refetchQueries = [{ query: DIAGRAM }];
  const refetchQueriesForModel = [...refetchQueries, { query: LIST_MODELS }];
  const getBaseOptions = (options) => {
    return {
      onError: (error) => console.error(error),
      refetchQueries,
      awaitRefetchQueries: true,
      ...options,
      onCompleted: () => {
        window.dispatchEvent(new Event('wren:modeling-changed'));
        // refetch to get latest deploy status
        deployStatusQueryResult.refetch();

        options.onCompleted && options.onCompleted();
      },
    };
  };

  const [createCalculatedField, { loading: calculatedFieldCreating }] =
    useCreateCalculatedFieldMutation(
      getBaseOptions({
        onError: null,
        onCompleted: () => {
          message.success('Successfully created calculated field.');
        },
      }),
    );

  const [updateCalculatedField, { loading: calculatedFieldUpdating }] =
    useUpdateCalculatedFieldMutation(
      getBaseOptions({
        onError: null,
        onCompleted: () => {
          message.success('Successfully updated calculated field.');
        },
      }),
    );

  const [deleteCalculatedField] = useDeleteCalculatedFieldMutation(
    getBaseOptions({
      onCompleted: () => {
        message.success('Successfully deleted calculated field.');
      },
    }),
  );

  const [createModelMutation, { loading: modelCreating }] =
    useCreateModelMutation(
      getBaseOptions({
        onCompleted: () => {
          message.success('Successfully created model.');
        },
        refetchQueries: refetchQueriesForModel,
      }),
    );

  const [deleteModelMutation] = useDeleteModelMutation(
    getBaseOptions({
      onCompleted: () => {
        message.success('Successfully deleted model.');
      },
      refetchQueries: refetchQueriesForModel,
    }),
  );

  const [updateModelMutation, { loading: modelUpdating }] =
    useUpdateModelMutation(
      getBaseOptions({
        onCompleted: () => {
          message.success('Successfully updated model.');
        },
        refetchQueries: refetchQueriesForModel,
      }),
    );

  const [deleteViewMutation] = useDeleteViewMutation(
    getBaseOptions({
      onCompleted: () => {
        message.success('Successfully deleted view.');
      },
    }),
  );

  const [updateModelMetadata, { loading: modelMetadataUpdating }] =
    useUpdateModelMetadataMutation(
      getBaseOptions({
        onCompleted: () => {
          message.success('Successfully updated model metadata.');
        },
      }),
    );

  const [createRelationshipMutation, { loading: relationshipCreating }] =
    useCreateRelationshipMutation(
      getBaseOptions({
        onCompleted: () => {
          message.success('Successfully created relationship.');
        },
      }),
    );

  const [deleteRelationshipMutation] = useDeleteRelationshipMutation(
    getBaseOptions({
      onCompleted: () => {
        message.success('Successfully deleted relationship.');
      },
    }),
  );

  const [updateRelationshipMutation, { loading: relationshipUpdating }] =
    useUpdateRelationshipMutation(
      getBaseOptions({
        onCompleted: () => {
          message.success('Successfully updated relationship.');
        },
      }),
    );

  const [updateViewMetadata, { loading: viewMetadataUpdating }] =
    useUpdateViewMetadataMutation(
      getBaseOptions({
        onCompleted: () => {
          message.success('Successfully updated view metadata.');
        },
      }),
    );
  const [generateModelingSemantics] = useMutation(GENERATE_MODELING_SEMANTICS);
  const [generateModelingRelationships] = useMutation(
    GENERATE_MODELING_RELATIONSHIPS,
  );

  const diagramData = useMemo(() => {
    if (!data) return null;
    return data?.diagram;
  }, [data]);

  const metadataDrawer = useDrawerAction();
  const modelDrawer = useDrawerAction();
  const editMetadataModal = useModalAction();
  const calculatedFieldModal = useModalAction();
  const relationshipModal = useRelationshipModal(diagramData);

  const queryParams = {
    viewId: searchParams.get('viewId'),
    openMetadata: searchParams.get('openMetadata'),
  };

  // doing actions if the route has specific query params
  useEffect(() => {
    if (!diagramData) return;
    // open view metadata drawer
    if (queryParams.viewId && queryParams.openMetadata) {
      const searchedView = diagramData.views.find(
        (view) => view.viewId === Number(queryParams.viewId),
      );
      !!searchedView && metadataDrawer.openDrawer(searchedView);
      // clear query params after opening the drawer
      router.replace(router.pathname);
    }
  }, [queryParams, diagramData]);

  useEffect(() => {
    if (metadataDrawer.state.visible) {
      const data = metadataDrawer.state.defaultValue;
      let currentNodeData = null;
      switch (data.nodeType) {
        case NODE_TYPE.MODEL: {
          currentNodeData = diagramData.models.find(
            (model) => model.modelId === data.modelId,
          );
          break;
        }

        case NODE_TYPE.VIEW: {
          currentNodeData = diagramData.views.find(
            (view) => view.viewId === data.viewId,
          );
          break;
        }

        default:
          break;
      }

      metadataDrawer.updateState(currentNodeData);
    }
  }, [diagramData]);

  // register event listener for global
  useEffect(() => {
    events.subscribe(events.EVENT_NAME.GO_TO_FIRST_MODEL, goToFirstModel);
    return () => {
      events.unsubscribe(events.EVENT_NAME.GO_TO_FIRST_MODEL, goToFirstModel);
    };
  }, []);

  const goToFirstModel = () => {
    if (diagramRef.current) {
      const { getNodes } = diagramRef.current;
      const node = getNodes()[0];
      node?.id && onSelect([node.id]);
    }
  };

  const onSelect = (selectKeys) => {
    if (diagramRef.current) {
      const { getNodes, fitBounds } = diagramRef.current;
      const node = getNodes().find((node) => node.id === selectKeys[0]);
      const position = {
        ...node.position,
        width: node.width,
        height: node.height,
      };
      fitBounds(position);
    }
  };

  const onNodeClick = async (payload: ClickPayload) => {
    metadataDrawer.openDrawer(payload.data);
  };

  const onMoreClick = (payload) => {
    const { type, data } = payload;
    const { nodeType } = data;
    const action = {
      [MORE_ACTION.UPDATE_COLUMNS]: () => {
        switch (nodeType) {
          case NODE_TYPE.MODEL:
            modelDrawer.openDrawer(data);
            break;
          default:
            console.log(data);
            break;
        }
      },
      [MORE_ACTION.EDIT]: () => {
        switch (nodeType) {
          case NODE_TYPE.CALCULATED_FIELD:
            editCalculatedField(
              { ...payload, diagramData },
              calculatedFieldModal.openModal,
            );
            break;
          case NODE_TYPE.RELATION:
            relationshipModal.openModal(data);
            break;

          default:
            console.log(data);
            break;
        }
      },
      [MORE_ACTION.DELETE]: async () => {
        switch (nodeType) {
          case NODE_TYPE.MODEL:
            await deleteModelMutation({
              variables: { where: { id: data.modelId } },
            });
            break;
          case NODE_TYPE.CALCULATED_FIELD:
            await deleteCalculatedField({
              variables: { where: { id: data.columnId } },
            });
            break;
          case NODE_TYPE.RELATION:
            await deleteRelationshipMutation({
              variables: { where: { id: data.relationId } },
            });
            break;
          case NODE_TYPE.VIEW:
            await deleteViewMutation({
              variables: { where: { id: data.viewId } },
            });
            break;

          default:
            console.log(data);
            break;
        }
      },
    };
    action[type] && action[type]();
  };

  const onAddClick = (payload) => {
    const { targetNodeType, data } = payload;
    switch (targetNodeType) {
      case NODE_TYPE.CALCULATED_FIELD:
        calculatedFieldModal.openModal(null, {
          models: diagramData.models,
          sourceModel: data,
        });
        break;
      case NODE_TYPE.RELATION:
        relationshipModal.openModal(data);
        break;
      default:
        console.log('add', targetNodeType);
        break;
    }
  };

  const calculatedFieldLoading =
    calculatedFieldCreating || calculatedFieldUpdating;
  const editMetadataLoading = modelMetadataUpdating || viewMetadataUpdating;
  const modelLoading = modelCreating || modelUpdating;
  const relationshipLoading = relationshipUpdating || relationshipCreating;

  const waitForAssistantResult = async (
    queryId: string,
    query: any,
    fieldName: string,
  ) => {
    if (!queryId) {
      throw new Error('AI assistant did not return a task id.');
    }

    for (let attempt = 0; attempt < 90; attempt += 1) {
      const res = await apolloClient.query({
        query,
        variables: { queryId },
        fetchPolicy: 'network-only',
      });
      const payload = res.data?.[fieldName];
      if (payload?.status === 'finished') return payload.response || [];
      if (payload?.status === 'failed') {
        throw new Error(payload.error?.message || 'AI assistant failed.');
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error('AI assistant timed out.');
  };

  const normalizeSemanticModel = (name: string, value: any): any => ({
    name: value?.name || name,
    description: value?.description || value?.properties?.description || '',
    columns: (value?.columns || []).map((column) => ({
      name: column?.name,
      type: column?.type,
      description: column?.description || column?.properties?.description || '',
    })),
  });

  const normalizeSemanticResult = (result: any): any[] => {
    if (Array.isArray(result)) {
      return result.map((model) => normalizeSemanticModel(model?.name, model));
    }
    if (Array.isArray(result?.models)) {
      return result.models.map((model) => normalizeSemanticModel(model?.name, model));
    }
    if (Array.isArray(result?.semantics)) {
      return result.semantics.map((model) =>
        normalizeSemanticModel(model?.name, model),
      );
    }
    if (Array.isArray(result?.descriptions)) {
      return result.descriptions.map((model) =>
        normalizeSemanticModel(model?.name, model),
      );
    }
    if (result && typeof result === 'object') {
      return Object.entries(result).map(([name, value]) =>
        normalizeSemanticModel(name, value),
      );
    }
    return [];
  };

  const normalizeRelationshipResult = (result: any): any[] => {
    if (Array.isArray(result)) return result;
    if (Array.isArray(result?.relationships)) return result.relationships;
    if (Array.isArray(result?.response?.relationships)) {
      return result.response.relationships;
    }
    return [];
  };

  const openAssistant = (mode: 'semantics' | 'relationships') => {
    setAssistantMode(mode);
    setSemanticStep('pick');
    setSemanticSearch('');
    setSelectedModels(diagramData?.models?.map((model) => model.referenceName) || []);
    setSemanticResult([]);
    setRelationshipResult([]);
  };

  const runAssistant = async () => {
    try {
      setAssistantLoading(true);
      if (assistantMode === 'semantics') {
        if (!selectedModels.length) {
          throw new Error('Select at least one model.');
        }
        const res = await generateModelingSemantics({
          variables: {
            data: {
              selectedModels,
              userPrompt: semanticPrompt || 'Describe this dataset for analytics.',
            },
          },
        });
        const queryId = res.data?.generateModelingSemantics?.queryId;
        const result = await waitForAssistantResult(
          queryId,
          MODELING_SEMANTICS_RESULT,
          'modelingSemanticsResult',
        );
        const normalizedResult = normalizeSemanticResult(result);
        setSemanticResult(normalizedResult);
        setSemanticStep('review');
      }
      if (assistantMode === 'relationships') {
        if (!diagramData?.models || diagramData.models.length < 2) {
          throw new Error('At least two models are required.');
        }
        const res = await generateModelingRelationships();
        const queryId = res.data?.generateModelingRelationships?.queryId;
        const result = await waitForAssistantResult(
          queryId,
          MODELING_RELATIONSHIPS_RESULT,
          'modelingRelationshipsResult',
        );
        setRelationshipResult(normalizeRelationshipResult(result));
      }
    } catch (error: any) {
      message.error(error.message || 'Failed to run Modeling AI Assistant.');
    } finally {
      setAssistantLoading(false);
    }
  };

  const updateSemanticModelDescription = (
    modelName: string,
    description: string,
  ) => {
    setSemanticResult((models) =>
      models.map((model) =>
        model.name === modelName ? { ...model, description } : model,
      ),
    );
  };

  const updateSemanticColumnDescription = (
    modelName: string,
    columnName: string,
    description: string,
  ) => {
    setSemanticResult((models) =>
      models.map((model) =>
        model.name === modelName
          ? {
              ...model,
              columns: (model.columns || []).map((column) =>
                column.name === columnName ? { ...column, description } : column,
              ),
            }
          : model,
      ),
    );
  };

  const closeAssistant = () => {
    setAssistantMode(null);
    setSemanticStep('pick');
    setSemanticSearch('');
  };

  const saveAssistantResult = async () => {
    try {
      if (!diagramData) return;
      setAssistantLoading(true);
      if (assistantMode === 'semantics') {
        for (const model of semanticResult) {
          const diagramModel = diagramData.models.find(
            (item) => item.referenceName === model.name,
          );
          if (!diagramModel) continue;
          await updateModelMetadata({
            variables: {
              where: { id: diagramModel.modelId },
              data: {
                description: model.description,
                columns: (model.columns || [])
                  .map((column) => {
                    const field = diagramModel.fields.find(
                      (item) => item.referenceName === column.name,
                    );
                    return field
                      ? {
                          id: field.columnId,
                          displayName: field.displayName,
                          description: column.description,
                        }
                      : null;
                  })
                  .filter(Boolean),
              },
            },
          });
        }
      }
      if (assistantMode === 'relationships') {
        for (const relationship of relationshipResult) {
          const fromModel = diagramData.models.find(
            (model) => model.referenceName === relationship.fromModel,
          );
          const toModel = diagramData.models.find(
            (model) => model.referenceName === relationship.toModel,
          );
          const fromField = fromModel?.fields.find(
            (field) => field.referenceName === relationship.fromColumn,
          );
          const toField = toModel?.fields.find(
            (field) => field.referenceName === relationship.toColumn,
          );
          if (!fromModel || !toModel || !fromField || !toField) continue;
          const alreadyExists = diagramData.models.some((model) =>
            (model.relationFields || []).some((field) => {
              if (!field) return false;
              const forward =
                field.fromModelName === relationship.fromModel &&
                field.fromColumnName === relationship.fromColumn &&
                field.toModelName === relationship.toModel &&
                field.toColumnName === relationship.toColumn;
              const reverse =
                field.fromModelName === relationship.toModel &&
                field.fromColumnName === relationship.toColumn &&
                field.toModelName === relationship.fromModel &&
                field.toColumnName === relationship.fromColumn;
              return forward || reverse;
            }),
          );
          if (alreadyExists) continue;
          await createRelationshipMutation({
            variables: {
              data: {
                fromModelId: fromModel.modelId,
                fromColumnId: fromField.columnId,
                toModelId: toModel.modelId,
                toColumnId: toField.columnId,
                type: relationship.type,
              },
            },
          });
        }
      }
      closeAssistant();
      message.success('Saved Modeling AI Assistant suggestions.');
    } catch (error: any) {
      message.error(error.message || 'Failed to save assistant suggestions.');
    } finally {
      setAssistantLoading(false);
    }
  };

  const semanticModelOptions = (diagramData?.models || []).filter((model) => {
    const keyword = semanticSearch.trim().toLowerCase();
    if (!keyword) return true;
    return [model.displayName, model.referenceName]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(keyword));
  });

  if (assistantMode === 'semantics') {
    return (
      <DeployStatusContext.Provider value={{ ...deployStatusQueryResult }}>
        <AssistantPage>
          <AssistantBack onClick={closeAssistant}>
            &larr; Back to modeling
          </AssistantBack>
          <AssistantCard>
            {semanticStep === 'pick' && (
              <>
                <AssistantTitle>Pick models</AssistantTitle>
                <AssistantDescription>
                  <strong>
                    Good semantics improve how AI understands and queries your
                    data.
                  </strong>{' '}
                  Select models to generate semantics with AI. Modeling AI
                  Assistant will help you create semantics that improve how AI
                  understands and queries your data.
                </AssistantDescription>
                <div className="mb-3">
                  {selectedModels.length}/{diagramData?.models?.length || 0}{' '}
                  model(s)
                </div>
                <Input
                  className="mb-3"
                  placeholder="Search here"
                  value={semanticSearch}
                  onChange={(event) => setSemanticSearch(event.target.value)}
                />
                <Table
                  size="small"
                  rowKey="referenceName"
                  pagination={false}
                  dataSource={semanticModelOptions}
                  rowSelection={{
                    selectedRowKeys: selectedModels,
                    preserveSelectedRowKeys: true,
                    onChange: (keys) => setSelectedModels(keys as string[]),
                  }}
                  columns={[
                    {
                      title: 'Model name',
                      render: (_value, model) =>
                        model.displayName || model.referenceName,
                    },
                  ]}
                />
                <AssistantFooter>
                  <span />
                  <Button
                    type="primary"
                    disabled={!selectedModels.length}
                    onClick={() => setSemanticStep('generate')}
                  >
                    Next
                  </Button>
                </AssistantFooter>
              </>
            )}

            {semanticStep === 'generate' && (
              <>
                <AssistantTitle>Generate semantics</AssistantTitle>
                <h3>User Prompt</h3>
                <AssistantDescription>
                  Help AI better understand your data by providing a brief
                  description of your dataset&apos;s purpose. Modeling AI
                  Assistant will use this context to generate more relevant
                  semantics.
                </AssistantDescription>
                <div style={{ display: 'flex', gap: 16 }}>
                  <Input.TextArea
                    rows={2}
                    value={semanticPrompt}
                    onChange={(event) => setSemanticPrompt(event.target.value)}
                    placeholder="Describe what this dataset represents and how it is used."
                  />
                  <Button
                    type="primary"
                    loading={assistantLoading}
                    onClick={runAssistant}
                  >
                    Generate
                  </Button>
                </div>
                <div
                  style={{
                    marginTop: 24,
                    padding: 16,
                    border: '1px solid #e5e7eb',
                    borderRadius: 4,
                  }}
                >
                  <strong>Example prompt</strong>
                  <div style={{ marginTop: 16, color: '#5f6368' }}>
                    This dataset tracks operational records, users, events, and
                    business entities. It is used to answer analytical questions
                    about activity, performance, ownership, and trends.
                  </div>
                </div>
                <AssistantFooter>
                  <Button onClick={() => setSemanticStep('pick')}>Back</Button>
                  <Button
                    disabled={!semanticResult.length}
                    onClick={() => setSemanticStep('review')}
                  >
                    Review
                  </Button>
                </AssistantFooter>
              </>
            )}

            {semanticStep === 'review' && (
              <>
                <AssistantTitle>Generate semantics</AssistantTitle>
                <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
                  <Input.TextArea
                    rows={2}
                    value={semanticPrompt}
                    onChange={(event) => setSemanticPrompt(event.target.value)}
                  />
                  <Button loading={assistantLoading} onClick={runAssistant}>
                    Regenerate
                  </Button>
                </div>
                <div
                  style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: 4,
                  }}
                >
                  <div style={{ padding: 16 }}>
                    <strong>Generated semantics</strong>
                    <div style={{ marginTop: 12, color: '#5f6368' }}>
                      Review the semantics generated by AI.
                    </div>
                  </div>
                  {semanticResult.map((model) => (
                    <SemanticReviewCard key={model.name}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginBottom: 16,
                        }}
                      >
                        <strong>{model.name}</strong>
                        <span style={{ color: '#9aa0a6' }}>
                          {(model.columns || []).length} column(s)
                        </span>
                      </div>
                      <div className="mb-2">Description</div>
                      <Input
                        className="mb-4"
                        value={model.description}
                        onChange={(event) =>
                          updateSemanticModelDescription(
                            model.name,
                            event.target.value,
                          )
                        }
                      />
                      <Table
                        size="small"
                        rowKey="name"
                        pagination={false}
                        dataSource={model.columns || []}
                        columns={[
                          { title: 'Name', dataIndex: 'name', width: 180 },
                          {
                            title: 'Alias',
                            dataIndex: 'name',
                            width: 180,
                          },
                          { title: 'Type', dataIndex: 'type', width: 140 },
                          {
                            title: 'Description',
                            render: (_value, column) => (
                              <Input
                                value={column.description}
                                onChange={(event) =>
                                  updateSemanticColumnDescription(
                                    model.name,
                                    column.name,
                                    event.target.value,
                                  )
                                }
                              />
                            ),
                          },
                        ]}
                      />
                    </SemanticReviewCard>
                  ))}
                </div>
                <AssistantFooter>
                  <Button onClick={() => setSemanticStep('generate')}>Back</Button>
                  <Button
                    type="primary"
                    loading={assistantLoading}
                    disabled={!semanticResult.length}
                    onClick={saveAssistantResult}
                  >
                    Save
                  </Button>
                </AssistantFooter>
              </>
            )}
          </AssistantCard>
        </AssistantPage>
      </DeployStatusContext.Provider>
    );
  }

  return (
    <DeployStatusContext.Provider value={{ ...deployStatusQueryResult }}>
      <SiderLayout
        loading={diagramData === null}
        sidebar={{
          data: diagramData,
          onOpenModelDrawer: modelDrawer.openDrawer,
          onSelect,
        }}
      >
        <DiagramWrapper>
          <AssistantAction>
            <Dropdown
              trigger={['hover', 'click']}
              overlay={
                <Menu
                  onClick={({ key }) =>
                    openAssistant(key as 'semantics' | 'relationships')
                  }
                >
                  <Menu.Item key="semantics">Generate semantics</Menu.Item>
                  <Menu.Item key="relationships">
                    Generate relationships
                  </Menu.Item>
                </Menu>
              }
            >
              <Button icon={<RobotOutlined />}>Modeling AI Assistant</Button>
            </Dropdown>
          </AssistantAction>
          <ForwardDiagram
            ref={diagramRef}
            data={diagramData}
            onMoreClick={onMoreClick}
            onNodeClick={onNodeClick}
            onAddClick={onAddClick}
          />
        </DiagramWrapper>
        <MetadataDrawer
          {...metadataDrawer.state}
          onClose={metadataDrawer.closeDrawer}
          onEditClick={editMetadataModal.openModal}
        />
        <EditMetadataModal
          {...editMetadataModal.state}
          onClose={editMetadataModal.closeModal}
          loading={editMetadataLoading}
          onSubmit={async ({ nodeType, data }) => {
            const { modelId, viewId, ...metadata } = data;
            switch (nodeType) {
              case NODE_TYPE.MODEL: {
                await updateModelMetadata({
                  variables: { where: { id: modelId }, data: metadata },
                });
                break;
              }

              case NODE_TYPE.VIEW: {
                await updateViewMetadata({
                  variables: { where: { id: viewId }, data: metadata },
                });
                break;
              }

              default:
                console.log('onSubmit', nodeType, data);
                break;
            }
          }}
        />
        <ModelDrawer
          {...modelDrawer.state}
          onClose={modelDrawer.closeDrawer}
          submitting={modelLoading}
          onSubmit={async ({ id, data }) => {
            if (id) {
              await updateModelMutation({ variables: { where: { id }, data } });
            } else {
              await createModelMutation({ variables: { data } });
            }
          }}
        />
        <CalculatedFieldModal
          {...calculatedFieldModal.state}
          onClose={calculatedFieldModal.closeModal}
          loading={calculatedFieldLoading}
          onSubmit={async ({ id, data }) => {
            if (id) {
              await updateCalculatedField({
                variables: { where: { id }, data },
              });
            } else {
              await createCalculatedField({ variables: { data } });
            }
          }}
        />
        <RelationModal
          {...relationshipModal.state}
          onClose={relationshipModal.onClose}
          loading={relationshipLoading}
          onSubmit={async (
            values: RelationFormValues & { relationId?: number },
          ) => {
            const relation = convertFormValuesToIdentifier(values);
            if (values.relationId) {
              await updateRelationshipMutation({
                variables: {
                  where: { id: values.relationId },
                  data: { type: relation.type },
                },
              });
            } else {
              await createRelationshipMutation({
                variables: {
                  data: {
                    fromModelId: Number(relation.fromField.modelId),
                    fromColumnId: Number(relation.fromField.fieldId),
                    toModelId: Number(relation.toField.modelId),
                    toColumnId: Number(relation.toField.fieldId),
                    type: relation.type,
                  },
                },
              });
            }
          }}
        />
        <Modal
          title="Modeling AI Assistant"
          visible={!!assistantMode}
          width={900}
          confirmLoading={assistantLoading}
          okText={
            semanticResult.length || relationshipResult.length ? 'Save' : 'Generate'
          }
          onOk={
            semanticResult.length || relationshipResult.length
              ? saveAssistantResult
              : runAssistant
          }
          onCancel={() => setAssistantMode(null)}
        >
          {assistantMode === 'semantics' && (
            <>
              <Select
                mode="multiple"
                className="mb-4"
                style={{ width: '100%' }}
                value={selectedModels}
                options={(diagramData?.models || []).map((model) => ({
                  label: model.displayName || model.referenceName,
                  value: model.referenceName,
                }))}
                onChange={(values) => setSelectedModels(values)}
              />
              <Input.TextArea
                rows={3}
                className="mb-4"
                placeholder="Describe what this dataset represents and how it is used."
                value={semanticPrompt}
                onChange={(event) => setSemanticPrompt(event.target.value)}
              />
              {!!semanticResult.length && (
                <Table
                  size="small"
                  rowKey="name"
                  pagination={false}
                  dataSource={semanticResult}
                  columns={[
                    { title: 'Model', dataIndex: 'name', width: 180 },
                    { title: 'Description', dataIndex: 'description' },
                  ]}
                  expandable={{
                    expandedRowRender: (model) => (
                      <Table
                        size="small"
                        rowKey="name"
                        pagination={false}
                        dataSource={model.columns || []}
                        columns={[
                          { title: 'Column', dataIndex: 'name', width: 180 },
                          { title: 'Description', dataIndex: 'description' },
                        ]}
                      />
                    ),
                  }}
                />
              )}
            </>
          )}
          {assistantMode === 'relationships' && (
            <Table
              size="small"
              rowKey={(record) =>
                `${record.fromModel}.${record.fromColumn}-${record.toModel}.${record.toColumn}`
              }
              pagination={false}
              dataSource={relationshipResult}
              columns={[
                {
                  title: 'From',
                  render: (_value, record) =>
                    `${record.fromModel}.${record.fromColumn}`,
                },
                {
                  title: 'To',
                  render: (_value, record) =>
                    `${record.toModel}.${record.toColumn}`,
                },
                { title: 'Type', dataIndex: 'type', width: 150 },
                { title: 'Description', dataIndex: 'reason' },
              ]}
            />
          )}
        </Modal>
      </SiderLayout>
    </DeployStatusContext.Provider>
  );
}
