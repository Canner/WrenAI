import { SearchOutlined } from '@ant-design/icons';
import { Input } from 'antd';

import {
  WorkbenchFilterChip,
  WorkbenchFilterRow,
  WorkbenchListCount,
  WorkbenchRailTop,
} from '@/features/knowledgePage/index.styles';

type KnowledgeWorkbenchRailFilterOption = {
  key: string;
  label: string;
};

type KnowledgeWorkbenchEditorRailControlsProps = {
  activeFilter: string;
  filterOptions: KnowledgeWorkbenchRailFilterOption[];
  searchPlaceholder: string;
  searchValue: string;
  totalCount: number;
  visibleCount: number;
  onFilterChange: (value: string) => void;
  onSearchChange: (value: string) => void;
};

export default function KnowledgeWorkbenchEditorRailControls({
  activeFilter,
  filterOptions,
  searchPlaceholder,
  searchValue,
  totalCount,
  visibleCount,
  onFilterChange,
  onSearchChange,
}: KnowledgeWorkbenchEditorRailControlsProps) {
  return (
    <WorkbenchRailTop>
      <Input
        allowClear
        value={searchValue}
        placeholder={searchPlaceholder}
        prefix={<SearchOutlined style={{ color: '#9ca3af' }} />}
        onChange={(event) => onSearchChange(event.target.value)}
      />
      <WorkbenchFilterRow>
        {filterOptions.map((option) => (
          <WorkbenchFilterChip
            key={option.key}
            type="button"
            $active={activeFilter === option.key}
            onClick={() => onFilterChange(option.key)}
          >
            {option.label}
          </WorkbenchFilterChip>
        ))}
      </WorkbenchFilterRow>
      <WorkbenchListCount>
        当前显示 {visibleCount} / {totalCount} 条
      </WorkbenchListCount>
    </WorkbenchRailTop>
  );
}
