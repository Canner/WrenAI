import {
  FilterOutlined,
  SortAscendingOutlined,
  GroupOutlined,
} from '@ant-design/icons';
import { ColumnsIcon, ModelIcon } from '@/utils/icons';
import { ReferenceType } from '@/apollo/client/graphql/__types__';

export type Reference = {
  id: number;
  title: string;
  type: ReferenceType;
  stepIndex: number;
  correctionPrompt?: string;
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
