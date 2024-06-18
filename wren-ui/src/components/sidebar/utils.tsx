import { DataNode } from 'antd/lib/tree';
import { getColumnTypeIcon } from '@/utils/columnType';
import { PrimaryKeyIcon, RelationshipIcon } from '@/utils/icons';
import { ComposeDiagramField } from '@/utils/data';
import { assign, isEmpty, snakeCase } from 'lodash';
import GroupTreeTitle, { IconsType } from './modeling/GroupTreeTitle';
import { getJoinTypeText } from '@/utils/data';
import { NODE_TYPE } from '@/utils/enum';
import { getNodeTypeIcon } from '@/utils/nodeType';

type TreeNode = DataNode;

const ColumnNode = ({ title, relation, primary }) => {
  const append = (
    <>
      {relation && (
        <span
          className="adm-treeNode--relation"
          title={`${relation.name}: ${getJoinTypeText(relation.joinType)}`}
        >
          <RelationshipIcon />
        </span>
      )}
      {primary && (
        <span className="adm-treeNode--primary" title="Primary Key">
          <PrimaryKeyIcon />
        </span>
      )}
    </>
  );

  return (
    <>
      <span title={title}>{title}</span>
      {append}
    </>
  );
};

const getChildrenSubtitle = (nodeKey: string, title: string) => [
  {
    title,
    key: `${nodeKey}_${snakeCase(title)}`,
    className: 'adm-treeNode--subtitle adm-treeNode--selectNone',
    selectable: false,
    isLeaf: true,
  },
];

export const getColumnNode = (
  nodeKey: string,
  columns: ComposeDiagramField[],
  title?: string,
): TreeNode[] => {
  if (columns.length === 0) return [];

  return [
    ...(title ? getChildrenSubtitle(nodeKey, title) : []),
    ...columns.map((column): TreeNode => {
      // show the model icon for relation item
      const isRelation = column.nodeType === NODE_TYPE.RELATION;
      const icon = isRelation
        ? getNodeTypeIcon({ nodeType: NODE_TYPE.MODEL })
        : getColumnTypeIcon(column, { title: column.type });

      return {
        icon,
        className: 'adm-treeNode adm-treeNode-column adm-treeNode--selectNode',
        title: (
          <ColumnNode
            title={column.displayName}
            relation={isRelation ? column : null}
            primary={column?.isPrimaryKey}
          />
        ),
        key: column.id,
        selectable: false,
        isLeaf: true,
      };
    }),
  ];
};

interface GroupSet {
  groupName: string;
  groupKey: string;
  quotaUsage?: number;
  appendSlot?: React.ReactNode;
  children?: DataNode[];
  icons: IconsType[];
}

export const createTreeGroupNode =
  (sourceData: GroupSet) => (updatedData?: Partial<GroupSet>) => {
    const {
      groupName = '',
      groupKey = '',
      quotaUsage,
      icons,
      children = [],
      appendSlot,
    } = assign(sourceData, updatedData);

    const emptyChildren = [
      {
        title: `No ${groupName}`,
        key: `${groupKey}-empty`,
        selectable: false,
        className: 'adm-treeNode adm-treeNode--empty adm-treeNode--selectNode',
      },
    ];
    const childrenData = isEmpty(children) ? emptyChildren : children;

    return [
      {
        className: 'adm-treeNode--group',
        title: (
          <GroupTreeTitle
            title={groupName}
            quotaUsage={quotaUsage}
            appendSlot={appendSlot}
            icons={icons}
          />
        ),
        key: groupKey,
        selectable: false,
        isLeaf: true,
      },
      ...childrenData,
    ];
  };
