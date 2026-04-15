import { useCallback, useEffect, useMemo, useState } from 'react';
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
  fetchSchemaChanges,
  resolveSchemaChange,
  triggerSchemaChangeDetection,
} from '@/utils/modelingRest';
import { getRelativeTime } from '@/utils/time';
import useRuntimeScopeNavigation from '@/hooks/useRuntimeScopeNavigation';

interface Props {
  [key: string]: any;
  models: DiagramModel[];
  onOpenModelDrawer: () => void;
  readOnly?: boolean;
  onRefresh?: () => Promise<unknown>;
}

const getHasSchemaChange = (schemaChange?: SchemaChange | null) => {
  return [
    schemaChange?.deletedTables,
    schemaChange?.deletedColumns,
    schemaChange?.modifiedColumns,
  ].some((changes) => (changes?.length || 0) > 0);
};

export default function ModelTree(props: Props) {
  const { onOpenModelDrawer, models, readOnly = false, onRefresh } = props;
  const runtimeScopeNavigation = useRuntimeScopeNavigation();

  const schemaChangeModal = useModalAction();
  const [schemaChangeData, setSchemaChangeData] = useState<SchemaChange | null>(
    null,
  );
  const [isDetecting, setIsDetecting] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const refetchSchemaChange = useCallback(async () => {
    const nextSchemaChange = await fetchSchemaChanges(
      runtimeScopeNavigation.selector,
    );
    setSchemaChangeData(nextSchemaChange);
    return nextSchemaChange;
  }, [runtimeScopeNavigation.selector]);

  useEffect(() => {
    void refetchSchemaChange().catch((error) => {
      message.error(
        error instanceof Error
          ? error.message
          : '加载结构变更失败，请稍后重试。',
      );
    });
  }, [refetchSchemaChange]);

  const hasSchemaChange = useMemo(
    () => getHasSchemaChange(schemaChangeData),
    [schemaChangeData],
  );
  const onOpenSchemaChange = () => {
    schemaChangeModal.openModal();
  };
  const onResolveSchemaChange = async (type: SchemaChangeType) => {
    setIsResolving(true);
    try {
      await resolveSchemaChange(runtimeScopeNavigation.selector, { type });
      if (type === SchemaChangeType.DELETED_TABLES) {
        message.success('已完成源表删除影响修复。');
      } else if (type === SchemaChangeType.DELETED_COLUMNS) {
        message.success('已完成源字段删除影响修复。');
      }

      const nextSchemaChange = await refetchSchemaChange();
      await onRefresh?.();
      if (!getHasSchemaChange(nextSchemaChange)) {
        schemaChangeModal.closeModal();
      }
    } catch (error) {
      message.error(
        error instanceof Error
          ? error.message
          : '修复结构变更失败，请稍后重试。',
      );
    } finally {
      setIsResolving(false);
    }
  };

  const onTriggerSchemaChangeDetection = async () => {
    setIsDetecting(true);
    try {
      const hasChanges = await triggerSchemaChangeDetection(
        runtimeScopeNavigation.selector,
      );
      if (hasChanges) {
        message.warning('检测到结构变更。');
      } else {
        message.success('当前没有结构变更。');
      }
      await refetchSchemaChange();
    } catch (error) {
      message.error(
        error instanceof Error
          ? error.message
          : '检测结构变更失败，请稍后重试。',
      );
    } finally {
      setIsDetecting(false);
    }
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
              schemaChangeData?.lastSchemaChangeTime
                ? `上次检测：${getRelativeTime(schemaChangeData.lastSchemaChangeTime)}`
                : ''
            }
            onClick={() => {
              if (!readOnly) {
                void onTriggerSchemaChangeDetection();
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
        defaultValue={schemaChangeData || undefined}
        payload={{ onResolveSchemaChange, isResolving }}
        onClose={schemaChangeModal.closeModal}
      />
    </>
  );
}
