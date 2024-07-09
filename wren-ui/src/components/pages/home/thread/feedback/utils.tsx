import {
  FilterOutlined,
  SortAscendingOutlined,
  GroupOutlined,
} from '@ant-design/icons';
import { ColumnsIcon, ModelIcon } from '@/utils/icons';

// TODO: Replace after provided by the backend
export enum ReferenceTypes {
  FIELD = 'FIELD',
  QUERY_FROM = 'QUERY_FROM',
  FILTER = 'FILTER',
  SORTING = 'SORTING',
  GROUP_BY = 'GROUP_BY',
}

export const getReferenceIcon = (type) => {
  return (
    {
      [ReferenceTypes.FIELD]: <ColumnsIcon />,
      [ReferenceTypes.QUERY_FROM]: <ModelIcon />,
      [ReferenceTypes.FILTER]: <FilterOutlined />,
      [ReferenceTypes.SORTING]: <SortAscendingOutlined />,
      [ReferenceTypes.GROUP_BY]: <GroupOutlined />,
    }[type] || null
  );
};
