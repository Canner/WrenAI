import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { useSearchParams } from 'next/navigation';
import React, { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Collapse,
  Dropdown,
  Input,
  Menu,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  message,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  RobotOutlined,
  SaveOutlined,
  TableOutlined,
} from '@ant-design/icons';
import { gql, useApolloClient, useMutation } from '@apollo/client';
import styled from 'styled-components';
import { MORE_ACTION, NODE_TYPE } from '@/utils/enum';
import { editCalculatedField } from '@/utils/modelingHelper';
import SimpleLayout from '@/components/layouts/SimpleLayout';
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

const SAVE_MODELING_RELATIONSHIPS = gql`
  mutation SaveModelingRelationships($data: [ModelingRelationshipInput!]!) {
    saveModelingRelationships(data: $data)
  }
`;

const SAVE_MODELING_SEMANTICS = gql`
  mutation SaveModelingSemantics($data: [SaveModelingSemanticInput!]!) {
    saveModelingSemantics(data: $data)
  }
`;

const Diagram = dynamic(() => import('@/components/diagram'), { ssr: false });
// https://github.com/vercel/next.js/issues/4957#issuecomment-413841689
const ForwardDiagram = forwardRef(function ForwardDiagram(props: any, ref) {
  return <Diagram {...props} forwardRef={ref} />;
});

const semanticText = (value: any): string => {
  if (Array.isArray(value)) {
    return value.map(semanticText).filter(Boolean).join(', ');
  }
  return typeof value === 'string' ? value.trim() : '';
};

const firstSemanticText = (...values: any[]): string =>
  values.map(semanticText).find(Boolean) || '';

const addSemanticText = <T extends Record<string, any>>(
  payload: T,
  key: string,
  value: any,
): T => {
  const text = semanticText(value);
  return text ? { ...payload, [key]: text } : payload;
};

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

const RelationshipGroup = styled.div`
  margin-top: 24px;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  overflow: hidden;
`;

const RelationshipGroupTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  border-bottom: 1px solid #e5e7eb;
`;

const AssistantCenter = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 170px;
  color: #0f3bff;
`;

type AssistantRelationship = {
  clientId: string;
  fromModel: string;
  fromColumn: string;
  toModel: string;
  toColumn: string;
  type: string;
  reason: string;
};

const SEMANTIC_EXAMPLE_PROMPTS = [
  {
    label: 'College',
    text: 'The purpose of this dataset is to monitor academic performance by tracking student enrollments, grades, and GPA calculations, and to identify areas for student support.',
  },
  {
    label: 'E-commerce',
    text: 'This dataset includes historical pricing information, discount rates, and promotional activities. It supports dynamic pricing strategies, promotion effectiveness analysis, and competitive pricing assessments.',
  },
  {
    label: 'Human Resources',
    text: 'This dataset tracks job postings, applicant details, interview processes, and hiring outcomes. It supports recruitment strategy optimization, time-to-hire analysis, and candidate sourcing effectiveness.',
  },
];

const RELATIONSHIP_TYPES = [
  { label: 'Many-to-one', value: 'MANY_TO_ONE' },
  { label: 'One-to-many', value: 'ONE_TO_MANY' },
  { label: 'One-to-one', value: 'ONE_TO_ONE' },
];

const relationshipTypeLabel = (type: string) =>
  RELATIONSHIP_TYPES.find((item) => item.value === type)?.label || type;

const normalizeRelationshipType = (type: string) => {
  const normalized = String(type || '')
    .trim()
    .replace(/[\s-]+/g, '_')
    .toUpperCase();
  if (normalized === 'MANY_TO_ONE') return 'MANY_TO_ONE';
  if (normalized === 'ONE_TO_MANY') return 'ONE_TO_MANY';
  if (normalized === 'ONE_TO_ONE') return 'ONE_TO_ONE';
  return type;
};

const getRelationshipFieldValue = (model = '', column = '') =>
  `${model}.${column}`;

const resolveRelationshipField = (
  value = '',
  models: Array<{ referenceName?: string; fields?: any[] }> = [],
) => {
  const fieldValue = String(value || '');
  for (const model of models) {
    for (const field of model.fields || []) {
      if (
        fieldValue ===
        getRelationshipFieldValue(model.referenceName, field.referenceName)
      ) {
        return {
          model: model.referenceName || '',
          column: field.referenceName || '',
        };
      }
    }
  }

  return { model: '', column: '' };
};

const resolveRelationshipFieldParts = (
  model = '',
  column = '',
  fallbackValue = '',
  models: Array<{ referenceName?: string; fields?: any[] }> = [],
) => {
  const resolvedField =
    model && column
      ? resolveRelationshipField(
          getRelationshipFieldValue(model, column),
          models,
        )
      : { model: '', column: '' };

  return resolvedField.model && resolvedField.column
    ? resolvedField
    : resolveRelationshipField(fallbackValue, models);
};

const renderIcon = (IconComponent) => React.createElement(IconComponent as any);
const ASSISTANT_CANCELLED = 'ASSISTANT_CANCELLED';
const ASSISTANT_SAVE_MESSAGE_KEY = 'modeling-ai-assistant-save';
const ASSISTANT_INITIAL_POLL_INTERVAL_MS = 1000;
const ASSISTANT_MAX_POLL_INTERVAL_MS = 5000;
const ASSISTANT_MAX_POLL_ATTEMPTS = 1800;

export default function Modeling() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const apolloClient = useApolloClient();
  const diagramRef = useRef(null);
  const assistantRunIdRef = useRef(0);
  const assistantSavingRef = useRef(false);
  const [assistantMode, setAssistantMode] = useState<
    'semantics' | 'relationships' | null
  >(null);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantSaving, setAssistantSaving] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [semanticPrompt, setSemanticPrompt] = useState('');
  const [semanticStep, setSemanticStep] = useState<'pick' | 'generate'>('pick');
  const [semanticSearch, setSemanticSearch] = useState('');
  const [semanticResult, setSemanticResult] = useState<any[]>([]);
  const [relationshipResult, setRelationshipResult] = useState<
    AssistantRelationship[]
  >([]);
  const [originalRelationshipResult, setOriginalRelationshipResult] = useState<
    AssistantRelationship[]
  >([]);
  const [relationshipAutoStarted, setRelationshipAutoStarted] = useState(false);
  const [editingRelationshipKey, setEditingRelationshipKey] = useState<
    string | null
  >(null);

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
  const [saveModelingSemantics] = useMutation(SAVE_MODELING_SEMANTICS);
  const [saveModelingRelationships] = useMutation(SAVE_MODELING_RELATIONSHIPS);

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
      const selectedKey = selectKeys?.[0];
      if (!selectedKey) return;

      const node = getNodes().find((node) => node.id === selectedKey);
      if (!node?.position) return;

      const position = {
        ...node.position,
        width: node.width ?? 1,
        height: node.height ?? 1,
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
    runId: number,
  ) => {
    if (!queryId) {
      throw new Error('AI assistant did not return a task id.');
    }

    for (let attempt = 0; attempt < ASSISTANT_MAX_POLL_ATTEMPTS; attempt += 1) {
      if (assistantRunIdRef.current !== runId) {
        throw new Error(ASSISTANT_CANCELLED);
      }
      const res = await apolloClient.query({
        query,
        variables: { queryId },
        fetchPolicy: 'network-only',
      });
      if (assistantRunIdRef.current !== runId) {
        throw new Error(ASSISTANT_CANCELLED);
      }
      const payload = res.data?.[fieldName];
      const status = String(payload?.status || '').toLowerCase();
      if (status === 'finished') return payload.response || [];
      if (status === 'failed') {
        throw new Error(payload.error?.message || 'AI assistant failed.');
      }
      const pollInterval = Math.min(
        ASSISTANT_INITIAL_POLL_INTERVAL_MS * Math.max(1, attempt + 1),
        ASSISTANT_MAX_POLL_INTERVAL_MS,
      );
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
    throw new Error('AI assistant timed out.');
  };

  const normalizeSemanticModel = (name: string, value: any): any => {
    const modelName = semanticText(value?.name) || semanticText(name);
    return {
      name: modelName,
      displayName: firstSemanticText(
        value?.displayName,
        value?.alias,
        value?.properties?.displayName,
        value?.properties?.alias,
      ),
      description: firstSemanticText(
        value?.description,
        value?.properties?.description,
      ),
      columns: (value?.columns || []).map((column) => {
        const columnName = semanticText(column?.name);
        return {
          name: columnName,
          type: column?.type,
          displayName: firstSemanticText(
            column?.displayName,
            column?.alias,
            column?.properties?.displayName,
            column?.properties?.alias,
          ),
          description: firstSemanticText(
            column?.description,
            column?.properties?.description,
          ),
        };
      }),
    };
  };

  const normalizeSemanticResult = (result: any): any[] => {
    if (Array.isArray(result)) {
      return result.map((model) => normalizeSemanticModel(model?.name, model));
    }
    if (Array.isArray(result?.models)) {
      return result.models.map((model) =>
        normalizeSemanticModel(model?.name, model),
      );
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

  const normalizeRelationshipResult = (
    result: any,
  ): AssistantRelationship[] => {
    const relationships = Array.isArray(result)
      ? result
      : Array.isArray(result?.relationships)
        ? result.relationships
        : Array.isArray(result?.response?.relationships)
          ? result.response.relationships
          : [];

    return relationships.map((relationship, index) => {
      const availableModels = diagramData?.models || [];
      const from = resolveRelationshipFieldParts(
        relationship.fromModel || '',
        relationship.fromColumn || '',
        relationship.from || relationship.fromField || '',
        availableModels,
      );
      const to = resolveRelationshipFieldParts(
        relationship.toModel || '',
        relationship.toColumn || '',
        relationship.to || relationship.toField || '',
        availableModels,
      );
      const fromModel = from.model;
      const fromColumn = from.column;
      const toModel = to.model;
      const toColumn = to.column;

      return {
        clientId:
          relationship.clientId ||
          [
            fromModel,
            fromColumn,
            toModel,
            toColumn,
            relationship.type,
            index,
          ].join(':'),
        fromModel,
        fromColumn,
        toModel,
        toColumn,
        type: normalizeRelationshipType(relationship.type),
        reason: relationship.reason || relationship.description || '',
      };
    });
  };

  const openAssistant = (mode: 'semantics' | 'relationships') => {
    assistantRunIdRef.current += 1;
    setAssistantMode(mode);
    setAssistantError(null);
    setAssistantSaving(false);
    setSemanticStep('pick');
    setSemanticSearch('');
    setSelectedModels(
      diagramData?.models?.map((model) => model.referenceName) || [],
    );
    setSemanticResult([]);
    setRelationshipResult([]);
    setOriginalRelationshipResult([]);
    setRelationshipAutoStarted(false);
    setEditingRelationshipKey(null);
  };

  const runAssistant = async () => {
    const runId = assistantRunIdRef.current + 1;
    assistantRunIdRef.current = runId;
    try {
      setAssistantLoading(true);
      setAssistantError(null);
      if (assistantMode === 'semantics') {
        if (!selectedModels.length) {
          throw new Error('Select at least one model.');
        }
        const res = await generateModelingSemantics({
          variables: {
            data: {
              selectedModels,
              userPrompt:
                semanticPrompt || 'Describe this dataset for analytics.',
            },
          },
        });
        const queryId = res.data?.generateModelingSemantics?.queryId;
        const result = await waitForAssistantResult(
          queryId,
          MODELING_SEMANTICS_RESULT,
          'modelingSemanticsResult',
          runId,
        );
        if (assistantRunIdRef.current !== runId) return;
        const normalizedResult = normalizeSemanticResult(result);
        if (!normalizedResult.length) {
          throw new Error('AI assistant returned no semantic descriptions.');
        }
        setSemanticResult(normalizedResult);
        setSemanticStep('generate');
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
          runId,
        );
        if (assistantRunIdRef.current !== runId) return;
        const normalizedResult = normalizeRelationshipResult(result);
        setRelationshipResult(normalizedResult);
        setOriginalRelationshipResult(normalizedResult);
      }
    } catch (error: any) {
      if (error.message !== ASSISTANT_CANCELLED) {
        const errorMessage =
          error.message || 'Failed to run Modeling AI Assistant.';
        setAssistantError(errorMessage);
        message.error(errorMessage);
      }
    } finally {
      if (assistantRunIdRef.current === runId) {
        setAssistantLoading(false);
      }
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

  const updateSemanticModelDisplayName = (
    modelName: string,
    displayName: string,
  ) => {
    setSemanticResult((models) =>
      models.map((model) =>
        model.name === modelName ? { ...model, displayName } : model,
      ),
    );
  };

  const updateSemanticColumnDisplayName = (
    modelName: string,
    columnName: string,
    displayName: string,
  ) => {
    setSemanticResult((models) =>
      models.map((model) =>
        model.name === modelName
          ? {
              ...model,
              columns: (model.columns || []).map((column) =>
                column.name === columnName
                  ? { ...column, displayName }
                  : column,
              ),
            }
          : model,
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
                column.name === columnName
                  ? { ...column, description }
                  : column,
              ),
            }
          : model,
      ),
    );
  };

  const updateRelationship = (
    clientId: string,
    changes: Partial<AssistantRelationship>,
  ) => {
    setRelationshipResult((relationships) =>
      relationships.map((relationship) =>
        relationship.clientId === clientId
          ? { ...relationship, ...changes }
          : relationship,
      ),
    );
  };

  const updateRelationshipField = (
    clientId: string,
    side: 'from' | 'to',
    value: string,
  ) => {
    const field = resolveRelationshipField(value, diagramData?.models || []);
    updateRelationship(
      clientId,
      side === 'from'
        ? { fromModel: field.model, fromColumn: field.column }
        : { toModel: field.model, toColumn: field.column },
    );
  };

  const deleteSuggestedRelationship = (clientId: string) => {
    setRelationshipResult((relationships) =>
      relationships.filter(
        (relationship) => relationship.clientId !== clientId,
      ),
    );
    if (editingRelationshipKey === clientId) {
      setEditingRelationshipKey(null);
    }
  };

  const closeAssistant = () => {
    assistantRunIdRef.current += 1;
    setAssistantMode(null);
    setAssistantError(null);
    setAssistantLoading(false);
    setAssistantSaving(false);
    setSemanticStep('pick');
    setSemanticSearch('');
    setRelationshipAutoStarted(false);
    setEditingRelationshipKey(null);
  };

  const saveAssistantResult = async () => {
    if (assistantSavingRef.current) return;
    assistantSavingRef.current = true;
    try {
      if (!diagramData) return;
      setAssistantSaving(true);
      if (assistantMode === 'semantics') {
        const latestDiagram = await apolloClient.query({
          query: DIAGRAM,
          fetchPolicy: 'network-only',
        });
        const currentModels = latestDiagram.data?.diagram?.models || [];
        const data = semanticResult.flatMap((model) => {
          const diagramModel = currentModels.find(
            (item) => item.referenceName === model.name,
          );
          if (!diagramModel) return [];
          const modelPayload = {
            modelId: diagramModel.modelId,
            referenceName: diagramModel.referenceName,
            columns: (model.columns || [])
              .map((column) => {
                const field = diagramModel.fields.find(
                  (item) => item.referenceName === column.name,
                );
                return field
                  ? addSemanticText(
                      addSemanticText(
                        {
                          id: field.columnId,
                          referenceName: field.referenceName,
                        },
                        'displayName',
                        column.displayName,
                      ),
                      'description',
                      column.description,
                    )
                  : null;
              })
              .filter(Boolean),
          };

          return addSemanticText(
            addSemanticText(modelPayload, 'displayName', model.displayName),
            'description',
            model.description,
          );
        });

        if (!data.length) {
          throw new Error('No semantic descriptions to save.');
        }

        await saveModelingSemantics({
          variables: { data },
          refetchQueries,
          awaitRefetchQueries: true,
        });
      }
      if (assistantMode === 'relationships') {
        const res = await saveModelingRelationships({
          variables: {
            data: relationshipResult.map((relationship) => ({
              fromModel: relationship.fromModel,
              fromColumn: relationship.fromColumn,
              toModel: relationship.toModel,
              toColumn: relationship.toColumn,
              type: relationship.type,
              description: relationship.reason,
            })),
          },
          refetchQueries,
          awaitRefetchQueries: true,
        });
        const createdCount =
          res.data?.saveModelingRelationships?.createdCount || 0;
        const skippedCount =
          res.data?.saveModelingRelationships?.skippedCount || 0;

        if (!createdCount) {
          throw new Error(
            skippedCount
              ? 'No valid new relationships could be saved for the current models.'
              : 'No relationship suggestions to save.',
          );
        }

        if (skippedCount) {
          message.warning(
            `${createdCount} relationship(s) saved. ${skippedCount} invalid or duplicate suggestion(s) skipped.`,
          );
        } else {
          message.success({
            key: ASSISTANT_SAVE_MESSAGE_KEY,
            content: 'Saved Modeling AI Assistant suggestions.',
          });
        }
      }
      closeAssistant();
      if (assistantMode !== 'relationships') {
        message.success({
          key: ASSISTANT_SAVE_MESSAGE_KEY,
          content: 'Saved Modeling AI Assistant suggestions.',
        });
      }
    } catch (error: any) {
      message.error(error.message || 'Failed to save assistant suggestions.');
    } finally {
      assistantSavingRef.current = false;
      setAssistantSaving(false);
    }
  };

  const semanticModelOptions = (diagramData?.models || []).filter((model) => {
    const keyword = semanticSearch.trim().toLowerCase();
    if (!keyword) return true;
    return [model.displayName, model.referenceName]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(keyword));
  });

  const relationshipFieldOptions = (diagramData?.models || []).flatMap(
    (model) =>
      (model.fields || []).map((field) => ({
        label: `${model.referenceName}.${field.referenceName}`,
        value: getRelationshipFieldValue(
          model.referenceName,
          field.referenceName,
        ),
      })),
  );

  const relationshipGroups = relationshipResult.reduce<
    Record<string, AssistantRelationship[]>
  >((groups, relationship) => {
    const key = relationship.fromModel || 'Unknown model';
    groups[key] = [...(groups[key] || []), relationship];
    return groups;
  }, {});

  const isRelationshipGenerating =
    assistantMode === 'relationships' &&
    (!relationshipAutoStarted || assistantLoading) &&
    !relationshipResult.length;

  useEffect(() => {
    if (assistantMode !== 'relationships') return;
    if (relationshipAutoStarted) return;
    setRelationshipAutoStarted(true);
    runAssistant();
  }, [assistantMode, relationshipAutoStarted]);

  useEffect(
    () => () => {
      assistantRunIdRef.current += 1;
    },
    [],
  );

  if (assistantMode === 'semantics') {
    return (
      <SimpleLayout loading={false}>
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
                      onChange={(event) =>
                        setSemanticPrompt(event.target.value)
                      }
                      placeholder="Describe what this dataset represents and how it is used."
                    />
                    <Button
                      type="primary"
                      loading={assistantLoading}
                      disabled={assistantLoading}
                      onClick={runAssistant}
                    >
                      {semanticResult.length ? 'Regenerate' : 'Generate'}
                    </Button>
                  </div>
                  {assistantLoading && (
                    <AssistantCenter>
                      <Spin />
                      <div style={{ marginTop: 10 }}>
                        Generating semantic descriptions...
                      </div>
                    </AssistantCenter>
                  )}
                  {assistantError && (
                    <Alert
                      className="mt-4"
                      showIcon
                      type="error"
                      message="Semantic generation failed"
                      description={assistantError}
                    />
                  )}
                  <Collapse
                    key={
                      semanticResult.length ? 'with-results' : 'without-results'
                    }
                    className="mt-4"
                    defaultActiveKey={semanticResult.length ? [] : ['examples']}
                  >
                    <Collapse.Panel header="Example prompt" key="examples">
                      <div style={{ marginBottom: 12, color: '#5f6368' }}>
                        Following, we provide some example prompts based on some
                        real world datasets.
                      </div>
                      <Space
                        direction="vertical"
                        size={12}
                        style={{ width: '100%' }}
                      >
                        {SEMANTIC_EXAMPLE_PROMPTS.map((example) => (
                          <div
                            key={example.label}
                            style={{
                              padding: 12,
                              background: '#eef4ff',
                              borderRadius: 4,
                            }}
                          >
                            <Tag color="blue">{example.label}</Tag>
                            <div style={{ marginTop: 10, color: '#5f6368' }}>
                              {example.text}
                            </div>
                          </div>
                        ))}
                      </Space>
                    </Collapse.Panel>
                  </Collapse>
                  {semanticResult.length ? (
                    <div
                      style={{
                        marginTop: 24,
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
                          <div className="mb-2">Alias / synonyms</div>
                          <Input
                            className="mb-4"
                            value={model.displayName}
                            onChange={(event) =>
                              updateSemanticModelDisplayName(
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
                                width: 180,
                                render: (_value, column) => (
                                  <Input
                                    value={column.displayName}
                                    onChange={(event) =>
                                      updateSemanticColumnDisplayName(
                                        model.name,
                                        column.name,
                                        event.target.value,
                                      )
                                    }
                                  />
                                ),
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
                  ) : null}
                  <AssistantFooter>
                    <Button onClick={() => setSemanticStep('pick')}>
                      Back
                    </Button>
                    <Button
                      type="primary"
                      loading={assistantSaving}
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
      </SimpleLayout>
    );
  }

  if (assistantMode === 'relationships') {
    return (
      <SimpleLayout loading={false}>
        <DeployStatusContext.Provider value={{ ...deployStatusQueryResult }}>
          <AssistantPage>
            <AssistantBack onClick={closeAssistant}>
              &larr; Back to modeling
            </AssistantBack>
            <AssistantCard>
              <AssistantTitle>Generate relationships</AssistantTitle>
              <AssistantDescription>
                Modeling AI Assistant will use AI to discover potential
                connections between your models.
                <br />
                Review the suggested relationships and adjust them before saving
                to your data models.
                <br />
                Learn more:{' '}
                <a
                  href="https://docs.getwren.ai/oss/guide/modeling/ai-assistant#generate-relationships"
                  target="_blank"
                  rel="noreferrer"
                >
                  Modeling AI Assistant / Generate relationships
                </a>
              </AssistantDescription>

              {isRelationshipGenerating ? (
                <AssistantCenter>
                  <Spin />
                  <div style={{ marginTop: 10 }}>Generating...</div>
                </AssistantCenter>
              ) : (
                <>
                  {assistantError ? (
                    <AssistantCenter>
                      <Alert
                        showIcon
                        type="error"
                        message="Relationship generation failed"
                        description={assistantError}
                      />
                    </AssistantCenter>
                  ) : !relationshipResult.length ? (
                    <AssistantCenter>
                      <div style={{ color: '#5f6368' }}>
                        No relationship suggestions were generated.
                      </div>
                    </AssistantCenter>
                  ) : null}

                  {Object.entries(relationshipGroups).map(
                    ([modelName, relationships]) => (
                      <RelationshipGroup key={modelName}>
                        <RelationshipGroupTitle>
                          {renderIcon(TableOutlined)}
                          <span>{modelName}</span>
                        </RelationshipGroupTitle>
                        <Table
                          size="small"
                          rowKey="clientId"
                          pagination={false}
                          dataSource={relationships}
                          columns={[
                            {
                              title: 'From',
                              width: 210,
                              render: (_value, record) =>
                                editingRelationshipKey === record.clientId ? (
                                  <Select
                                    showSearch
                                    style={{ width: '100%' }}
                                    value={getRelationshipFieldValue(
                                      record.fromModel,
                                      record.fromColumn,
                                    )}
                                    options={relationshipFieldOptions}
                                    optionFilterProp="label"
                                    onChange={(value) =>
                                      updateRelationshipField(
                                        record.clientId,
                                        'from',
                                        value,
                                      )
                                    }
                                  />
                                ) : (
                                  getRelationshipFieldValue(
                                    record.fromModel,
                                    record.fromColumn,
                                  )
                                ),
                            },
                            {
                              title: 'To',
                              width: 210,
                              render: (_value, record) =>
                                editingRelationshipKey === record.clientId ? (
                                  <Select
                                    showSearch
                                    style={{ width: '100%' }}
                                    value={getRelationshipFieldValue(
                                      record.toModel,
                                      record.toColumn,
                                    )}
                                    options={relationshipFieldOptions}
                                    optionFilterProp="label"
                                    onChange={(value) =>
                                      updateRelationshipField(
                                        record.clientId,
                                        'to',
                                        value,
                                      )
                                    }
                                  />
                                ) : (
                                  getRelationshipFieldValue(
                                    record.toModel,
                                    record.toColumn,
                                  )
                                ),
                            },
                            {
                              title: 'Type',
                              width: 170,
                              render: (_value, record) =>
                                editingRelationshipKey === record.clientId ? (
                                  <Select
                                    style={{ width: '100%' }}
                                    value={record.type}
                                    options={RELATIONSHIP_TYPES}
                                    onChange={(type) =>
                                      updateRelationship(record.clientId, {
                                        type,
                                      })
                                    }
                                  />
                                ) : (
                                  relationshipTypeLabel(record.type)
                                ),
                            },
                            {
                              title: 'Description',
                              render: (_value, record) =>
                                editingRelationshipKey === record.clientId ? (
                                  <Input.TextArea
                                    autoSize={{ minRows: 2, maxRows: 4 }}
                                    value={record.reason}
                                    onChange={(event) =>
                                      updateRelationship(record.clientId, {
                                        reason: event.target.value,
                                      })
                                    }
                                  />
                                ) : (
                                  record.reason
                                ),
                            },
                            {
                              title: '',
                              width: 92,
                              render: (_value, record) => (
                                <Space>
                                  <Button
                                    type="text"
                                    icon={
                                      editingRelationshipKey === record.clientId
                                        ? renderIcon(SaveOutlined)
                                        : renderIcon(EditOutlined)
                                    }
                                    onClick={() =>
                                      setEditingRelationshipKey(
                                        editingRelationshipKey ===
                                          record.clientId
                                          ? null
                                          : record.clientId,
                                      )
                                    }
                                  />
                                  <Button
                                    type="text"
                                    icon={renderIcon(DeleteOutlined)}
                                    onClick={() =>
                                      deleteSuggestedRelationship(
                                        record.clientId,
                                      )
                                    }
                                  />
                                </Space>
                              ),
                            },
                          ]}
                        />
                      </RelationshipGroup>
                    ),
                  )}

                  <AssistantFooter>
                    <Button
                      onClick={() => {
                        setRelationshipResult(originalRelationshipResult);
                        setEditingRelationshipKey(null);
                      }}
                    >
                      Discard
                    </Button>
                    <Button
                      type="primary"
                      loading={assistantSaving}
                      disabled={!relationshipResult.length}
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
      </SimpleLayout>
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
              <Button icon={renderIcon(RobotOutlined)}>
                Modeling AI Assistant
              </Button>
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
                    fromModelReferenceName: relation.fromField.modelName,
                    fromColumnId: Number(relation.fromField.fieldId),
                    fromColumnReferenceName: relation.fromField.fieldName,
                    toModelId: Number(relation.toField.modelId),
                    toModelReferenceName: relation.toField.modelName,
                    toColumnId: Number(relation.toField.fieldId),
                    toColumnReferenceName: relation.toField.fieldName,
                    type: relation.type,
                  },
                },
              });
            }
          }}
        />
      </SiderLayout>
    </DeployStatusContext.Provider>
  );
}
