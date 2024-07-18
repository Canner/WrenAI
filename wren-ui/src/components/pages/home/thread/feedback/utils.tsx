import {
  FilterOutlined,
  SortAscendingOutlined,
  GroupOutlined,
} from '@ant-design/icons';
import { ColumnsIcon, ModelIcon } from '@/utils/icons';
import {
  DetailReference,
  ReferenceType,
} from '@/apollo/client/graphql/__types__';

export type Reference = DetailReference & {
  stepIndex: number;
  referenceNum: number;
  correctionPrompt?: string;
};

export const REFERENCE_ORDERS = [
  ReferenceType.FIELD,
  ReferenceType.QUERY_FROM,
  ReferenceType.FILTER,
  ReferenceType.SORTING,
  ReferenceType.GROUP_BY,
];

export const getReferenceName = (type: ReferenceType) => {
  return (
    {
      [ReferenceType.FIELD]: 'Fields',
      [ReferenceType.QUERY_FROM]: 'Query from',
      [ReferenceType.FILTER]: 'Filter',
      [ReferenceType.SORTING]: 'Sorting',
      [ReferenceType.GROUP_BY]: 'Group by',
    }[type] || null
  );
};

export const getReferenceIcon = (type) => {
  return (
    {
      [ReferenceType.FIELD]: <ColumnsIcon />,
      [ReferenceType.QUERY_FROM]: <ModelIcon />,
      [ReferenceType.FILTER]: <FilterOutlined />,
      [ReferenceType.SORTING]: <SortAscendingOutlined />,
      [ReferenceType.GROUP_BY]: <GroupOutlined />,
    }[type] || null
  );
};
