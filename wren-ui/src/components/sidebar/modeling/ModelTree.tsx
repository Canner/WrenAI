import { useEffect, useMemo, useState } from 'react';
import { message } from 'antd';
import { DataNode } from 'antd/es/tree';
import { DiagramModel } from '@/utils/data';
import { getNodeTypeIcon } from '@/utils/nodeType';
import {
  createTreeGroupNode,
  getColumnNode,
  GroupActionButton,
} from '@/components/sidebar/utils';
import useModalAction from '@/hooks/useModalAction';
import LabelTitle from '@/components/sidebar/LabelTitle';
import PlusOutlined from '@ant-design/icons/PlusOutlined';
import WarningOutlined from '@ant-design/icons/WarningOutlined';
import ReloadOutlined from '@ant-design/icons/ReloadOutlined';
import { StyledSidebarTree } from '@/components/sidebar/Modeling';
import SchemaChangeModal from '@/components/modals/SchemaChangeModal';
import {
  SchemaChange,
  SchemaChangeType,
} from '@/apollo/client/graphql/__types__';
import {
  useResolveSchemaChangeMutation,
  useSchemaChangeQuery,
  useTriggerDataSourceDetectionMutation,
} from '@/apollo/client/graphql/dataSource.generated';
import { DIAGRAM } from '@/apollo/client/graphql/diagram';
import { getRelativeTime } from '@/utils/time';

interface Props {
  [key: string]: any;
  models: DiagramModel[];
  onOpenModelDrawer: () => void;
  readOnly?: boolean;
}

const getHasSchemaChange = (schemaChange?: SchemaChange | null) => {
  return [
    schemaChange?.deletedTables,
    schemaChange?.deletedColumns,
    schemaChange?.modifiedColumns,
  ].some((changes) => (changes?.length || 0) > 0);
};

export default function ModelTree(props: Props) {
  const { onOpenModelDrawer, models, readOnly = false } = props;

  const schemaChangeModal = useModalAction();
  const [triggerDataSourceDetection, { loading: isDetecting }] =
    useTriggerDataSourceDetectionMutation({
      onError: (error) => {
        message.error(error.message || '检测结构变更失败，请稍后重试。');
      },
      onCompleted: async (data) => {
        if (data.triggerDataSourceDetection) {
          message.warning('检测到结构变更。');
        } else {
          message.success('当前没有结构变更。');
        }
        await refetchSchemaChange();
      },
    });
  const [resolveSchemaChange, { loading: isResolving }] =
    useResolveSchemaChangeMutation({
      onError: (error) => {
        message.error(error.message || '修复结构变更失败，请稍后重试。');
      },
      onCompleted: async (_, options) => {
        const type = options?.variables?.where?.type;
        if (type === SchemaChangeType.DELETED_TABLES) {
          message.success('已完成源表删除影响修复。');
        } else if (type === SchemaChangeType.DELETED_COLUMNS) {
          message.success('已完成源字段删除影响修复。');
        }

        const { data } = await refetchSchemaChange();
        // if all schema changes are resolved, close the modal
        if (!getHasSchemaChange(data.schemaChange)) {
          schemaChangeModal.closeModal();
        }
      },
      refetchQueries: [{ query: DIAGRAM }],
    });
  const { data: schemaChangeData, refetch: refetchSchemaChange } =
    useSchemaChangeQuery({
      fetchPolicy: 'cache-and-network',
    });
  const hasSchemaChange = useMemo(
    () => getHasSchemaChange(schemaChangeData?.schemaChange),
    [schemaChangeData],
  );
  const onOpenSchemaChange = () => {
    schemaChangeModal.openModal();
  };
  const onResolveSchemaChange = (type: SchemaChangeType) => {
    resolveSchemaChange({ variables: { where: { type } } });
  };

  const getModelGroupNode = createTreeGroupNode({
    groupName: '数据模型',
    groupKey: 'models',
    emptyLabel: '暂无数据模型',
    actions: [
      {
        key: 'trigger-schema-detection',
        icon: () => (
          <ReloadOutlined
            spin={isDetecting}
            title={
              schemaChangeData?.schemaChange.lastSchemaChangeTime
                ? `上次检测：${getRelativeTime(schemaChangeData?.schemaChange.lastSchemaChangeTime)}`
                : ''
            }
            onClick={() => {
              if (!readOnly) {
                triggerDataSourceDetection();
              }
            }}
          />
        ),
        disabled: isDetecting || readOnly,
      },
      {
        key: 'add-model',
        render: () => (
          <GroupActionButton
            data-guideid="add-model"
            data-testid="add-model"
            icon={<PlusOutlined />}
            size="small"
            disabled={readOnly}
            onClick={() => onOpenModelDrawer()}
          >
            新增
          </GroupActionButton>
        ),
      },
    ],
  });

  const [tree, setTree] = useState<DataNode[]>(getModelGroupNode());

  useEffect(() => {
    setTree((_tree) =>
      getModelGroupNode({
        quotaUsage: models.length,
        appendSlot: hasSchemaChange && (
          <span className="adm-actionIcon mx-2" onClick={onOpenSchemaChange}>
            <WarningOutlined className="orange-5" title="查看结构变更影响" />
          </span>
        ),
        children: models.map((model) => {
          const nodeKey = model.id;

          const modelFields = [
            ...model.fields,
            ...model.calculatedFields,
          ].filter(
            (field): field is NonNullable<(typeof model.fields)[number]> =>
              field != null,
          );
          const children = [...getColumnNode(nodeKey, modelFields)];

          return {
            children,
            className: 'adm-treeNode',
            icon: getNodeTypeIcon({ nodeType: model.nodeType }),
            id: nodeKey,
            isLeaf: false,
            key: nodeKey,
            title: <LabelTitle title={model.displayName} />,
            type: model.nodeType,
          };
        }),
      }),
    );
  }, [models, hasSchemaChange, schemaChangeData, isDetecting, readOnly]);

  return (
    <>
      <StyledSidebarTree {...props} treeData={tree} />
      <SchemaChangeModal
        {...schemaChangeModal.state}
        defaultValue={schemaChangeData?.schemaChange}
        payload={{ onResolveSchemaChange, isResolving }}
        onClose={schemaChangeModal.closeModal}
      />
    </>
  );
}
