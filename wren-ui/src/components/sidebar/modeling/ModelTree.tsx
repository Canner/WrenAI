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
import { LIST_MODELS } from '@/apollo/client/graphql/model';
import { getRelativeTime } from '@/utils/time';

interface Props {
  [key: string]: any;
  models: DiagramModel[];
  onOpenModelDrawer: () => void;
}

const getHasSchemaChange = (schemaChange: SchemaChange) => {
  return [
    schemaChange?.deletedTables,
    schemaChange?.deletedColumns,
    schemaChange?.modifiedColumns,
  ].some((changes) => !!changes);
};

export default function ModelTree(props: Props) {
  const { onOpenModelDrawer, models } = props;

  const schemaChangeModal = useModalAction();
  const [triggerDataSourceDetection, { loading: isDetecting }] =
    useTriggerDataSourceDetectionMutation({
      onError: (error) => console.error(error),
      onCompleted: async (data) => {
        if (data.triggerDataSourceDetection) {
          message.warning('Schema change detected.');
        } else {
          message.success('There is no schema change.');
        }
        await refetchSchemaChange();
      },
    });
  const [resolveSchemaChange, { loading: isResolving }] =
    useResolveSchemaChangeMutation({
      onError: (error) => console.error(error),
      onCompleted: async (_, options) => {
        const { type } = options.variables?.where;
        if (type === SchemaChangeType.DELETED_TABLES) {
          message.success('Source table deleted resolved successfully.');
        } else if (type === SchemaChangeType.DELETED_COLUMNS) {
          message.success('Source column deleted resolved successfully.');
        }

        const { data } = await refetchSchemaChange();
        // if all schema changes are resolved, close the modal
        if (!getHasSchemaChange(data.schemaChange)) {
          schemaChangeModal.closeModal();
        }
      },
      refetchQueries: [{ query: DIAGRAM }, { query: LIST_MODELS }],
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
    groupName: 'Models',
    groupKey: 'models',
    actions: [
      {
        key: 'trigger-schema-detection',
        disabled: isDetecting,
        icon: () => (
          <ReloadOutlined
            spin={isDetecting}
            title={
              schemaChangeData?.schemaChange.lastSchemaChangeTime
                ? `Last refresh ${getRelativeTime(schemaChangeData?.schemaChange.lastSchemaChangeTime)}`
                : ''
            }
            onClick={() => triggerDataSourceDetection()}
          />
        ),
      },
      {
        key: 'add-model',
        render: () => (
          <GroupActionButton
            data-guideid="add-model"
            data-testid="add-model"
            icon={<PlusOutlined />}
            size="small"
            onClick={() => onOpenModelDrawer()}
          >
            New
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
            <WarningOutlined
              className="orange-5"
              title="Review schema change impacts"
            />
          </span>
        ),
        children: models.map((model) => {
          const nodeKey = model.id;

          const children = [
            ...getColumnNode(nodeKey, [
              ...model.fields,
              ...model.calculatedFields,
            ]),
          ];

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
  }, [models, hasSchemaChange, schemaChangeData, isDetecting]);

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
